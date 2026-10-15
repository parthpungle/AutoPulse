"""Turn downloaded car models into AutoPulse line-art cars (Blender 5.x, headless):

    blender -b --factory-startup --disable-autoexec -P blender/convert_models.py -- <out_dir> [car_type ...]

Sources (CC BY 4.0, credited in README.md) are downloaded from Sketchfab into blender/source/
(not committed). For each car this script:
  1. loads the model, bakes every transform and modifier (subdivision off), drops hidden variants;
  2. orients it the AutoPulse way: length along +X with the front at +X, ground at z = 0, centred;
  3. sorts every part by its object and material names into body, glass, lights, interior,
     underbody, wheels and engine;
  4. extracts line art: panel boundaries and sharp creases (the panel gaps and design lines a
     technical illustrator draws), all quad edges as faint surface flow, interior and mechanical
     feature edges;
  5. adds what the models lack (radiator, battery, fuel system, and the engine if absent), placed
     from the measured wheel positions and bonnet height, all named zone_* for health colouring;
  6. exports <car_type>.glb with the same object names the web app already understands.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import build_cars as bc  # noqa: E402  (shared helpers: wire_mesh, box, cylinder, materials, engine bay)

SRC = os.path.join(os.path.dirname(__file__), "source")
CARS = {
    "sedan": dict(src="generic-sedan-car/source/01-passat-generic-sedan-full-v1.blend"),
    "suv": dict(src="mmc-generic-small-suv-car/source/mmc-generic-small-suv-01.fbx"),
    "coupe": dict(src="generic-sport-coupe-car/source/coupe-sport-generic-mmc.fbx"),
    "pickup": dict(src="lightbody-lifted-85-low-poly-model/source/krmlgtbdy.fbx"),
    "hatchback": dict(src="generic-passenger-car-pack/source/fab.fbx",
                      only=("Hatchback Body", "Wheel_B", "Wheel_B001", "Wheel_B002", "Wheel_B003")),
}
TARGET_LEN = {"hatchback": 3.95, "sedan": 4.62, "suv": 4.45, "pickup": 5.10, "coupe": 4.45}


# ----------------------------------------------------------------------------- loading
def load(path, only=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if path.lower().endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=path)
    else:                                    # append objects only; scripts never run (--disable-autoexec)
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = list(src.objects)
        for o in dst.objects:
            if o is not None:
                bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.update()
    for o in list(bpy.context.scene.objects):
        rig_widget = o.name.startswith("WGT") or (o.type == "MESH" and not o.data.polygons)   # rig control shapes, empties
        if o.type == "MESH" and (rig_widget or o.hide_render or (only and o.name not in only)):
            bpy.data.objects.remove(o, do_unlink=True)


def bake():
    """Every mesh becomes a standalone object in world space with modifiers applied (no subdivision)."""
    for o in bpy.context.scene.objects:
        for m in getattr(o, "modifiers", []):
            if m.type in ("SUBSURF", "MULTIRES"):
                m.show_viewport = False
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), depsgraph=dg)
        if not me.polygons:
            continue
        me.transform(o.matrix_world)
        mats = [s.material for s in o.material_slots]
        nob = bpy.data.objects.new(o.name, me)
        me.materials.clear()
        for m in mats:
            me.materials.append(m)
        out.append(nob)
    for o in list(bpy.context.scene.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for o in out:
        bpy.context.scene.collection.objects.link(o)
    return out


def split_by_material(objs):
    """One object per material, so a mirror's glass and a body's chrome trim can be told apart."""
    out = []
    for o in objs:
        me = o.data
        if len(me.materials) <= 1:
            out.append(o)
            continue
        for mi, mat in enumerate(me.materials):
            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != mi], context="FACES")
            if not bm.faces:
                bm.free()
                continue
            for f in bm.faces:
                f.material_index = 0
            nm = bpy.data.meshes.new(f"{o.name}.{mi}")
            bm.to_mesh(nm); bm.free()
            nm.materials.append(mat)
            no = bpy.data.objects.new(f"{o.name}|{mat.name if mat else mi}", nm)
            bpy.context.scene.collection.objects.link(no)
            out.append(no)
        bpy.data.objects.remove(o, do_unlink=True)
    return out


# ----------------------------------------------------------------------------- orientation
def bounds(objs):
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            lo = Vector(map(min, lo, v.co)); hi = Vector(map(max, hi, v.co))
    return lo, hi


FRONT_WORDS = ("front", "hood", "headl", "head-l", "grill", "engine", "windshield", "bonnet", "bullbar", "_fl", "_fr", ".ft.")
REAR_WORDS = ("rear", "trunk", "tail", "back", "boot", "brakelight", "reverse", "_rl", "_rr", ".bk.", "spoiler", "diffus")


def square_up(objs):
    """Rotate about Z so the footprint's principal axis lies along X (some packs park cars at an angle)."""
    pts = [(v.co.x, v.co.y) for o in objs for v in o.data.vertices]
    mx = sum(p[0] for p in pts) / len(pts); my = sum(p[1] for p in pts) / len(pts)
    sxx = sum((p[0] - mx) ** 2 for p in pts); syy = sum((p[1] - my) ** 2 for p in pts)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
    snap = round(ang / (math.pi / 2)) * (math.pi / 2)
    ang = snap if abs(ang - snap) < math.radians(3) else ang       # already axis-aligned: keep it exact
    if abs(ang) > 1e-4:
        T = Matrix.Translation((mx, my, 0)) @ Matrix.Rotation(-ang, 4, "Z") @ Matrix.Translation((-mx, -my, 0))
        for o in objs:
            o.data.transform(T)
        print(f"  squared up by {math.degrees(-ang):.1f} deg")


def orient(objs, car_type):
    square_up(objs)
    lo, hi = bounds(objs)
    size = hi - lo
    axis = 0 if size.x >= size.y else 1                      # the car's length
    ctr = (lo + hi) / 2
    score = 0.0
    for o in objs:
        n = o.name.lower()
        c = sum((v.co for v in o.data.vertices), Vector()) / max(len(o.data.vertices), 1)
        d = c[axis] - ctr[axis]
        if any(w in n for w in FRONT_WORDS):
            score += d
        if any(w in n for w in REAR_WORDS):
            score -= d
    sign = 1 if score >= 0 else -1
    # rotation that maps (axis, sign) to +X, keeping Z up
    if axis == 0:
        R = Matrix.Identity(4) if sign > 0 else Matrix.Rotation(math.pi, 4, "Z")
    else:
        R = Matrix.Rotation(-math.pi / 2, 4, "Z") if sign > 0 else Matrix.Rotation(math.pi / 2, 4, "Z")
    for o in objs:
        o.data.transform(R)
    lo, hi = bounds(objs)
    L = hi.x - lo.x
    k = 1.0 if 3.4 <= L <= 5.8 else TARGET_LEN[car_type] / L
    T = Matrix.Diagonal((k, k, k, 1)) @ Matrix.Translation((-lo.x, -(lo.y + hi.y) / 2, -lo.z))
    for o in objs:
        o.data.transform(T)
    print(f"  orient: length axis {'XY'[axis]}, front {'+' if sign > 0 else '-'}, length {L * k:.2f} m (scale {k:.3f})")


# ----------------------------------------------------------------------------- classification
def classify(o):
    n = o.name.lower()
    m = (o.data.materials[0].name.lower() if o.data.materials and o.data.materials[0] else "")
    t = n + " " + m
    if any(w in t for w in ("tire", "tyre")):
        return "tyre"
    if any(w in t for w in ("wheel", "wheek", "rim", "brake-caliper", "caliper", "brake-disc", "brake disc")):
        return "wheel"
    if any(w in t for w in ("interior", "seat", "dashboard", "steering", "console", "door-panel", "roof-lining",
                            "pillars-interior", "media", "_interior")):
        return "interior"
    if "engine" in t or ("mechanics" in t and "chassis" not in t):
        return "engine"
    if any(w in t for w in ("chassis", "frame", "suspension", "spring", "shock", "damper", "pipe", "escape", "exhaust",
                            "bottom", "floor", "wiper", "numberplate", "badge", "plate")):
        return "detail"
    if "optics" in t:
        return "light"
    if any(w in t for w in ("taillight", "brakelight", "reverse", "glass - red", "red")):
        return "light_rear"
    if any(w in t for w in ("headlight", "headligth", "drl", "blinker", "led", "lens", "headlights")):
        return "light"
    if any(w in t for w in ("glass", "windshield", "window", "windscreen")):
        return "glass"
    return "body"


# ----------------------------------------------------------------------------- line extraction
def edges_of(objs, mode, angle=35.0):
    """mode: 'all' (every polygon edge), 'feature' (boundaries + creases sharper than angle), 'boundary'."""
    segs = []
    lim = math.radians(angle)
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.normal_update()
        for e in bm.edges:
            if mode == "all":
                keep = True
            elif mode == "boundary":
                keep = e.is_boundary
            else:
                keep = e.is_boundary or (len(e.link_faces) == 2 and e.calc_face_angle(0) > lim) or len(e.link_faces) > 2
            if keep:
                segs.append((e.verts[0].co.copy(), e.verts[1].co.copy()))
        bm.free()
    return segs


def thin(segs, max_n):
    """Keep long, evenly spread segments when a source is denser than the browser needs."""
    if len(segs) <= max_n:
        return segs
    step = len(segs) / max_n
    return [segs[int(i * step)] for i in range(max_n)]


def profile(objs, L, bins=120):
    """Body height along the car: max z per slice, lightly smoothed -> top(x)."""
    zs = [0.0] * bins
    for o in objs:
        for v in o.data.vertices:
            i = min(bins - 1, max(0, int(v.co.x / L * bins)))
            zs[i] = max(zs[i], v.co.z)
    for i in range(1, bins):                                  # fill empty slices
        if zs[i] == 0:
            zs[i] = zs[i - 1]
    sm = [sum(zs[max(0, i - 2):i + 3]) / len(zs[max(0, i - 2):i + 3]) for i in range(bins)]
    return lambda x: sm[min(bins - 1, max(0, int(x / L * bins)))]


# ----------------------------------------------------------------------------- the conversion
def convert(car_type, out_dir):
    cfg = CARS[car_type]
    print(f"[{car_type}] {cfg['src']}")
    load(os.path.join(SRC, cfg["src"]), cfg.get("only"))
    objs = split_by_material(bake())
    orient(objs, car_type)
    for o in objs:                                           # textures are not needed: drop UVs and colours
        for uv in list(o.data.uv_layers):
            o.data.uv_layers.remove(uv)
        for ca in list(o.data.color_attributes):
            o.data.color_attributes.remove(ca)

    groups = {}
    for o in objs:
        groups.setdefault(classify(o), []).append(o)
    print("  parts:", {k: len(v) for k, v in groups.items()})
    body = groups.get("body", [])
    lo, hi = bounds(body or objs)
    L, W = hi.x, hi.y - lo.y

    mats = {
        "body": bc.material("Body", (0.18, 0.18, 0.19)), "glass": bc.material("Glass", (0.03, 0.04, 0.05), alpha=0.5),
        "head": bc.material("LightFront", (0.9, 0.92, 1.0)), "tail": bc.material("LightRear", (0.6, 0.02, 0.02)),
        "zone": bc.material("Zone", (0.45, 0.78, 0.61)), "tyre": bc.material("Tyre", (0.02, 0.02, 0.02)),
        "wire": bc.material("Wire", (0.8, 0.77, 0.74)), "trim": bc.material("Trim", (0.03, 0.03, 0.03)),
    }
    root = bc.link(bpy.data.objects.new(f"car_{car_type}", None))
    shell = bc.link(bpy.data.objects.new("body", None), root)

    # wheels: tyre meshes give centres and radius; front/rear and left/right from position
    wheel_objs = groups.get("tyre", []) + groups.get("wheel", [])
    tyres = groups.get("tyre") or groups.get("wheel", [])
    centres = []
    for o in tyres:
        a, b = bounds([o])
        centres.append(((a + b) / 2, (b.z - a.z) / 2, o))
    xm = (min(c[0].x for c in centres) + max(c[0].x for c in centres)) / 2 if centres else L / 2
    R = sum(c[1] for c in centres) / len(centres) if centres else 0.32

    def corner(p):
        return ("f" if p.x > xm else "r") + ("l" if p.y > 0 else "r")

    hubs = {}
    for k in ("fl", "fr", "rl", "rr"):
        hubs[k] = bc.link(bpy.data.objects.new(f"tyre_{k}", None), root)
    xs_f = [c[0].x for c in centres if c[0].x > xm] or [L * 0.78]
    xs_r = [c[0].x for c in centres if c[0].x <= xm] or [L * 0.2]
    xf, xr = sum(xs_f) / len(xs_f), sum(xs_r) / len(xs_r)
    if tyres:                                                # mirrors or stray shadow planes can inflate the body width
        tl, th = bounds(tyres)
        W = min(W, th.y - tl.y + 0.12)

    # ---- body shell (occluder + silhouettes in the browser) and its line art
    for o in body:
        o.data.materials.clear(); o.data.materials.append(mats["body"])
        o.parent = shell
    for o in groups.get("glass", []):
        o.data.materials.clear(); o.data.materials.append(mats["glass"])
        o.parent = shell
    faces = sum(len(o.data.polygons) for o in body)
    bc.wire_mesh("wire_body", edges_of(body, "feature", 38), root, mats["wire"])
    if faces > 9000:                                         # dense, real topology reads as CAD surface flow
        bc.wire_mesh("wire_flow", thin(edges_of(body, "all"), 90000), root, mats["wire"])
    bc.wire_mesh("wire_glass", edges_of(groups.get("glass", []), "feature", 40), root, mats["wire"])

    # ---- lights: split front / rear by position
    for o in groups.get("light", []) + groups.get("light_rear", []):
        a, b = bounds([o])
        rear = classify(o) == "light_rear" or (a.x + b.x) / 2 < L / 2
        o.data.materials.clear(); o.data.materials.append(mats["tail" if rear else "head"])
        o.name = ("taillight_" if rear else "headlight_") + o.name[:40]
        o.parent = root

    # ---- interior, underbody, wheel detail -> lines; source meshes removed
    if groups.get("interior"):
        bc.wire_mesh("interior_lines", thin(edges_of(groups["interior"], "feature", 30), 60000), root, mats["wire"])
    if groups.get("detail"):
        bc.wire_mesh("detail_lines", thin(edges_of(groups["detail"], "feature", 30), 40000), root, mats["wire"])
    for o in wheel_objs:
        a, b = bounds([o])
        k = corner((a + b) / 2)
        if o in tyres:
            o.data.materials.clear(); o.data.materials.append(mats["tyre"])
            o.name = f"tyre_{k}_tyre"
            o.parent = hubs[k]
        if o not in tyres or not groups.get("tyre"):         # rims, calipers (or whole wheels in simple models)
            bc.wire_mesh(f"tyre_{k}_wire_{len(hubs[k].children)}", thin(edges_of([o], "feature", 30), 8000), hubs[k], mats["wire"])
        if o not in tyres:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in groups.get("interior", []) + groups.get("detail", []):
        bpy.data.objects.remove(o, do_unlink=True)

    # ---- engine bay: the model's own engine if it has one, plus radiator, battery and fuel system
    top = profile(body or objs, L)
    floor = min(v.co.z for o in body for v in o.data.vertices) if body else 0.2
    spec = dict(L=L, W=W, R=R, floor=max(floor, 0.12), xf=xf, xr=xr)
    own_engine = groups.get("engine", [])
    for i, o in enumerate(own_engine):
        o.data.materials.clear(); o.data.materials.append(mats["zone"])
        o.name = f"zone_engine_{i}"
        o.parent = root
    bc.build_engine_bay(spec, mats, root, top, engine=not own_engine)

    root.location = (-L / 2, 0, 0)
    for o in [o for o in bpy.context.scene.objects if o.parent is None and o is not root]:
        bpy.data.objects.remove(o, do_unlink=True)
    os.makedirs(out_dir, exist_ok=True)
    glb = os.path.join(out_dir, f"{car_type}.glb")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, f"{car_type}.blend"))
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_apply=True, use_mesh_edges=True,
                              export_texcoords=False, export_normals=True)
    print(f"  built {car_type}: L={L:.2f} W={W:.2f} R={R:.2f} xf={xf:.2f} xr={xr:.2f}, body faces {faces}, "
          f"{os.path.getsize(glb) / 1e6:.1f} MB")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out_dir = os.path.abspath(argv[0]) if argv else os.path.join(os.path.dirname(__file__), "out")
    for t in (argv[1:] or list(CARS)):
        convert(t, out_dir)
