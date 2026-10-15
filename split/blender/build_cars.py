"""Procedural car models for AutoPulse (Blender 4.x/5.x, run headless):

    blender -b -P blender/build_cars.py -- <out_dir> [car_type ...]

Builds one clean, moderately detailed model per car type (hatchback, sedan, SUV, pickup, coupe):
a lofted body (smooth cross-sections along the length, wheel arches, tumblehome), glass,
head/tail lights, grille, mirrors, tyres with spoked rims, plus named health zones
(zone_engine, zone_battery, zone_cooling, zone_fuel, tyre_fl/fr/rl/rr) that the UI can light up.
Writes <type>.glb (for the web app), <type>.blend (to open and tweak) and <type>.png (preview).
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

# ----------------------------------------------------------------------------- body specs
# x along the car (0 = rear, L = front), z up, metres. "top" = roofline control points (x, z).
CARS = {
    "hatchback": dict(L=3.95, W=1.74, R=0.30, xr=0.66, xf=3.22, floor=0.20,
                      top=[(0.00, 0.50), (0.02, 0.92), (0.10, 1.30), (0.35, 1.46), (1.30, 1.50), (2.05, 1.46),
                           (2.62, 1.04), (3.35, 0.92), (3.85, 0.80), (3.95, 0.55)],
                      belt=(0.98, 0.96), glass=(0.18, 2.55), windshield=(2.08, 2.58), rearglass=(0.05, 0.36),
                      pillars=(1.45,), doors=(2.80, 1.45, 1.06)),
    "sedan": dict(L=4.62, W=1.80, R=0.31, xr=0.95, xf=3.68, floor=0.19,
                  top=[(0.00, 0.52), (0.04, 0.88), (0.30, 0.98), (0.90, 1.02), (1.45, 1.40), (2.20, 1.46),
                       (2.85, 1.42), (3.42, 1.00), (4.15, 0.90), (4.55, 0.78), (4.62, 0.55)],
                  belt=(0.96, 0.95), glass=(0.98, 3.38), windshield=(2.86, 3.40), rearglass=(0.95, 1.44),
                  pillars=(2.15,), doors=(3.25, 2.15, 1.38), trunk=True),
    "suv": dict(L=4.72, W=1.90, R=0.37, xr=0.98, xf=3.78, floor=0.28,
                top=[(0.00, 0.62), (0.02, 1.30), (0.12, 1.66), (0.40, 1.76), (2.90, 1.78), (3.48, 1.24),
                     (4.30, 1.12), (4.66, 1.00), (4.72, 0.70)],
                belt=(1.20, 1.16), glass=(0.14, 3.45), windshield=(2.92, 3.46), rearglass=(0.04, 0.38),
                pillars=(1.50, 2.30), rails=True, doors=(3.28, 2.30, 1.48)),
    "pickup": dict(L=5.30, W=1.92, R=0.39, xr=1.05, xf=4.28, floor=0.32,
                   top=[(0.00, 0.70), (0.02, 1.14), (1.88, 1.16), (1.96, 1.30), (2.05, 1.78), (3.30, 1.80),
                        (3.88, 1.26), (4.85, 1.12), (5.24, 1.00), (5.30, 0.74)],
                   belt=(1.16, 1.18), glass=(2.06, 3.86), windshield=(3.32, 3.88), rearglass=(1.97, 2.06),
                   pillars=(2.75,), bed=(0.06, 1.86), doors=(3.78, 2.75, 2.02)),
    "coupe": dict(L=4.42, W=1.86, R=0.33, xr=0.90, xf=3.55, floor=0.15,
                  top=[(0.00, 0.50), (0.04, 0.84), (0.40, 0.94), (0.85, 1.02), (1.55, 1.28), (2.35, 1.32),
                       (3.10, 0.96), (3.95, 0.80), (4.36, 0.66), (4.42, 0.48)],
                  belt=(0.92, 0.88), glass=(0.88, 3.08), windshield=(2.38, 3.10), rearglass=(0.86, 1.55),
                  pillars=(), spoiler=True, doors=(3.10, 1.72), trunk=True),
}

ST = 110      # stations along the length
RING = 40     # points around each cross-section


# ----------------------------------------------------------------------------- helpers
def smooth_curve(pts, n=400):
    """Catmull-Rom through control points, sampled densely; returns callable z(x)."""
    P = [pts[0]] + pts + [pts[-1]]
    xs, zs = [], []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(20):
            t = k / 20
            t2, t3 = t * t, t * t * t
            xs.append(0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                             + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3))
            zs.append(0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                             + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3))
    xs.append(pts[-1][0]); zs.append(pts[-1][1])
    pairs = sorted(zip(xs, zs))

    def z_of(x):
        if x <= pairs[0][0]:
            return pairs[0][1]
        for (xa, za), (xb, zb) in zip(pairs, pairs[1:]):
            if xa <= x <= xb:
                return za + (zb - za) * (x - xa) / max(xb - xa, 1e-9)
        return pairs[-1][1]
    return z_of


def material(name, color, metallic=0.0, rough=0.5, emit=None, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 2.0
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            pass
    m.diffuse_color = (*color, alpha)     # viewport / Workbench preview colour
    if emit is not None:
        m.diffuse_color = (*emit, 1)
    return m


def link(obj, parent=None):
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def wire_mesh(name, segments, parent, mat, location=(0, 0, 0)):
    """Edges-only mesh; glTF exports it as LINES, so the browser draws exactly these lines."""
    verts, edges = [], []
    for a, b in segments:
        verts += [tuple(a), tuple(b)]
        edges.append((len(verts) - 2, len(verts) - 1))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, edges, [])
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    ob.location = location
    return link(ob, parent)


def box(name, center, size, mat, parent=None, bevel=0.01):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=2, affect="EDGES")
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    ob.location = center
    return link(ob, parent)


def cylinder(name, radius, depth, center, mat, parent=None, verts=40, axis="Y"):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=radius, radius2=radius, depth=depth)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = abs(p.normal.z) < 0.9
    ob = bpy.data.objects.new(name, me)
    ob.location = center
    if axis == "Y":
        ob.rotation_euler = (math.pi / 2, 0, 0)
    return link(ob, parent)


# ----------------------------------------------------------------------------- body loft
HALF_PTS = 21  # points on each half cross-section


def section(w, zb, zt, belt):
    """Car-like half cross-section from bottom centre to top centre: flat floor, rounded sill,
    near-vertical side up to the belt line, a crisp shoulder, glasshouse leaning inward, crowned roof.
    Cabin and hood/boot shapes are blended smoothly by how far the top rises above the belt line."""
    cabin = _resample(_cabin_pts(w, zb, max(zt, belt + 0.12), min(belt, zt - 0.10)))
    panel = _resample(_panel_pts(w, zb, zt))
    t = max(0.0, min(1.0, (zt - belt) / 0.18))
    t = t * t * (3 - 2 * t)                    # smoothstep
    if t >= 1:
        return _resample(_cabin_pts(w, zb, zt, belt))
    return [(a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t) for a, b in zip(panel, cabin)]


def _cabin_pts(w, zb, zt, belt):
    return [(0.0, zb), (w * 0.86, zb), (w * 0.97, zb + 0.04), (w, zb + 0.12),
            (w * 1.005, belt - 0.10), (w * 0.99, belt), (w * 0.95, belt + 0.03),
            (w * 0.84, belt + 0.45 * (zt - belt)), (w * 0.76, zt - 0.05), (w * 0.62, zt - 0.012), (0.0, zt + 0.012)]


def _panel_pts(w, zb, zt):
    return [(0.0, zb), (w * 0.86, zb), (w * 0.97, zb + 0.04), (w, zb + 0.12),
            (w * 1.005, max(zb + 0.14, zt - 0.14)), (w * 0.985, zt - 0.05), (w * 0.90, zt - 0.012),
            (w * 0.55, zt + 0.004), (0.0, zt + 0.012)]


def _resample(pts):
    """Resample a polyline by arc length so every station has the same number of points."""
    seg = [math.dist(a, b) for a, b in zip(pts, pts[1:])]
    total = sum(seg)
    out, acc, j = [], 0.0, 0
    for k in range(HALF_PTS):
        target = total * k / (HALF_PTS - 1)
        while j < len(seg) - 1 and acc + seg[j] < target:
            acc += seg[j]; j += 1
        t = 0.0 if seg[j] == 0 else (target - acc) / seg[j]
        a, b = pts[j], pts[j + 1]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def build_body(spec, mats, root):
    L, W, R = spec["L"], spec["W"], spec["R"]
    top = smooth_curve(spec["top"])
    floor = spec["floor"]
    arches = [(spec["xr"], R + 0.06), (spec["xf"], R + 0.06)]
    belt_r, belt_f = spec["belt"]

    def zbot(x):
        z = floor
        for xa, ra in arches:
            dx = x - xa
            if abs(dx) < ra:
                z = max(z, R + math.sqrt(ra * ra - dx * dx) * 0.92 - 0.02)
        return z

    def half_w(x):
        e = min(x, L - x)
        return (W / 2) * (0.80 + 0.20 * math.sqrt(max(0.0, min(1.0, e / 0.55))))

    def belt(x):
        return belt_r + (belt_f - belt_r) * x / L

    # stations, denser near the ends
    xs = [L * (0.5 - 0.5 * math.cos(math.pi * i / (ST - 1))) for i in range(ST)]
    bm = bmesh.new()
    rings = []
    for x in xs:
        zt, zb = top(x), zbot(x)
        zt = max(zt, zb + 0.10)
        hw, bl = half_w(x), belt(x)
        half = section(hw, zb, zt, bl)          # half cross-section, bottom-centre -> top-centre
        full = half + [(-y, z) for y, z in reversed(half[1:-1])]
        rings.append([bm.verts.new((x, y, z)) for y, z in full])
    global RING
    RING = len(rings[0])
    faces = []
    for i in range(ST - 1):
        for k in range(RING):
            a, b = rings[i][k], rings[i][(k + 1) % RING]
            c, d = rings[i + 1][(k + 1) % RING], rings[i + 1][k]
            faces.append(bm.faces.new((a, b, c, d)))
    for ring, rev in ((rings[0], True), (rings[-1], False)):
        ctr = bm.verts.new(tuple(sum(v.co[j] for v in ring) / RING for j in range(3)))
        for k in range(RING):
            vs = (ring[k], ring[(k + 1) % RING], ctr)
            bm.faces.new(vs[::-1] if rev else vs)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    # material slots: 0 body, 1 glass, 2 dark trim (sills / bumpers lower)
    g0, g1 = spec["glass"]
    w0, w1 = spec["windshield"]
    r0, r1 = spec["rearglass"]
    pillars = spec.get("pillars", ())
    for f in bm.faces:
        cx, cy, cz = f.calc_center_median()
        n = f.normal
        hw = half_w(cx)
        idx = 0
        if cz > belt(cx) + 0.04 and g0 <= cx <= g1:
            on_side = abs(n.y) > 0.55 and abs(cy) > 0.45 * hw
            in_shield = (w0 <= cx <= w1) or (r0 <= cx <= r1)
            roofish = n.z > 0.85 and not in_shield
            near_pillar = any(abs(cx - p) < 0.05 for p in pillars) or abs(cx - w0) < 0.05 or abs(cx - g0) < 0.04
            if (on_side or in_shield) and not roofish and not (on_side and near_pillar):
                idx = 1
        if cz < zbot(cx) + 0.07 and abs(n.z) < 0.7:
            idx = 2
        f.material_index = idx
        f.smooth = True
    # wireframe as a designer draws a car: feature lines, not a grid.
    #   wire_body    primary lines - sill & wheel arches, belt/shoulder, roof edges, spine, door cuts, shut lines
    #   wire_section secondary lines - a few faint cross-sections at the axles and pillars
    coords = [[v.co.copy() for v in ring] for ring in rings]
    H = HALF_PTS

    def nearest(i, side, target):
        """Index on station i's half-section (side +1 / -1) closest to a target (y, z) in section space."""
        ring = coords[i]
        idxs = range(H) if side > 0 else [0] + list(range(RING - 1, H - 1, -1)) + [H - 1]
        return min(idxs, key=lambda k: (abs(ring[k].y) - target[0]) ** 2 + (ring[k].z - target[1]) ** 2)

    feat = {}                                                # (name, side) -> list of 3D points or None per station
    for i, x in enumerate(xs):
        zt, zb, w, bl = max(top(x), zbot(x) + 0.10), zbot(x), half_w(x), belt(x)
        for side in (1, -1):
            feat.setdefault(("sill", side), []).append(coords[i][nearest(i, side, (w, zb + 0.12))])
            feat.setdefault(("belt", side), []).append(coords[i][nearest(i, side, (w * 0.99, min(bl, zt - 0.05)))])
            roof = coords[i][nearest(i, side, (w * 0.76, zt - 0.05))] if zt > bl + 0.18 else None
            feat.setdefault(("roof", side), []).append(roof)
        feat.setdefault(("spine", 0), []).append(coords[i][H - 1])
    segs = []
    for pts in feat.values():
        segs += [(a, b) for a, b in zip(pts, pts[1:]) if a is not None and b is not None]

    def station(x):
        return min(range(len(xs)), key=lambda i: abs(xs[i] - x))

    def side_arc(i, side, k0, k1):
        ring = coords[i]
        idxs = list(range(H)) if side > 0 else [0] + list(range(RING - 1, H - 1, -1)) + [H - 1]
        a, b = sorted((idxs.index(k0), idxs.index(k1)))
        return [(ring[idxs[j]], ring[idxs[j + 1]]) for j in range(a, b)]

    def top_arc(x):
        """Shut line across the top: from one belt/shoulder point over the top to the other."""
        i = station(x)
        zt, w, bl = top(xs[i]), half_w(xs[i]), belt(xs[i])
        out = []
        for side in (1, -1):
            k = nearest(i, side, (w * 0.99, min(bl, zt - 0.05)))
            out += side_arc(i, side, k, H - 1)
        return out

    for dx in spec.get("doors", ()):                         # door cut lines: sill up to the belt, both sides
        i = station(dx)
        zt, zb, w, bl = top(xs[i]), zbot(xs[i]), half_w(xs[i]), belt(xs[i])
        for side in (1, -1):
            segs += side_arc(i, side, nearest(i, side, (w, zb + 0.12)), nearest(i, side, (w * 0.99, min(bl, zt - 0.05))))
    w0, w1 = spec["windshield"]
    for x in (w1 + 0.03, L - 0.24, 0.10) + ((spec["rearglass"][0] - 0.03,) if spec.get("trunk") else ()):
        segs += top_arc(x)                                   # hood rear & front, tail, boot lid
    wire_mesh("wire_body", segs, root, mats["wire"])

    sec = []
    for x in {0.05, spec["xr"], spec["xf"], L - 0.05, spec["glass"][0], spec["windshield"][0], *spec.get("pillars", ())}:
        ring = coords[station(x)]
        sec += [(ring[k], ring[(k + 1) % RING]) for k in range(RING)]
    wire_mesh("wire_section", sec, root, mats["wire"])
    glass_edges = []
    for e in bm.edges:                                       # window outlines: where glass meets body
        if len(e.link_faces) == 2 and (e.link_faces[0].material_index == 1) != (e.link_faces[1].material_index == 1):
            glass_edges.append((e.verts[0].co.copy(), e.verts[1].co.copy()))
    wire_mesh("wire_glass", glass_edges, root, mats["wire"])

    me = bpy.data.meshes.new("body")
    bm.to_mesh(me); bm.free()
    for m in (mats["body"], mats["glass"], mats["trim"]):
        me.materials.append(m)
    ob = bpy.data.objects.new("body", me)
    link(ob, root)
    mod = ob.modifiers.new("smooth", "WEIGHTED_NORMAL")
    mod.keep_sharp = True
    return ob, top, belt, half_w


# ----------------------------------------------------------------------------- details
def build_wheel(name, x, side, spec, mats, root):
    R = spec["R"]
    hub = bpy.data.objects.new(name, None)
    hub.location = (x, side * (spec["W"] / 2 - 0.12), R)
    link(hub, root)
    tw = 0.24
    # tyre: torus flattened across its width
    bm = bmesh.new()
    seg, ring_seg = 56, 14
    rr, tr = R - 0.075, 0.075
    verts = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        row = []
        for j in range(ring_seg):
            b = 2 * math.pi * j / ring_seg
            rad = rr + tr * math.cos(b)
            row.append(bm.verts.new((rad * math.cos(a), (tw / 2) * math.sin(b) * 1.05, rad * math.sin(a))))
        verts.append(row)
    for i in range(seg):
        for j in range(ring_seg):
            bm.faces.new((verts[i][j], verts[(i + 1) % seg][j], verts[(i + 1) % seg][(j + 1) % ring_seg],
                          verts[i][(j + 1) % ring_seg]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # tyre wire: tread, outer and inner sidewall circles; rim circle and five line spokes on the outer face
    tsegs = []
    for j in (0, 3, 11):
        tsegs += [(verts[i][j].co.copy(), verts[(i + 1) % seg][j].co.copy()) for i in range(seg)]
    rim_r, fy = R - 0.105, side * 0.06
    circ = [Vector((rim_r * math.cos(2 * math.pi * k / 40), fy, rim_r * math.sin(2 * math.pi * k / 40))) for k in range(40)]
    tsegs += [(circ[k], circ[(k + 1) % 40]) for k in range(40)]
    hubc = [Vector((0.06 * math.cos(2 * math.pi * k / 16), fy, 0.06 * math.sin(2 * math.pi * k / 16))) for k in range(16)]
    tsegs += [(hubc[k], hubc[(k + 1) % 16]) for k in range(16)]
    for k in range(5):
        a = 2 * math.pi * k / 5 + math.pi / 2
        for off in (-0.035, 0.035):                    # each spoke as a slim pair of lines
            ca, sa = math.cos(a + off / 0.1), math.sin(a + off / 0.1)
            cb, sb = math.cos(a + off / rim_r), math.sin(a + off / rim_r)
            tsegs.append((Vector((0.06 * ca, fy, 0.06 * sa)), Vector((rim_r * 0.96 * cb, fy, rim_r * 0.96 * sb))))
    wire_mesh(name + "_wire", tsegs, hub, mats["wire"])
    me = bpy.data.meshes.new(name + "_tyre"); bm.to_mesh(me); bm.free()
    me.materials.append(mats["tyre"])
    for p in me.polygons:
        p.use_smooth = True
    link(bpy.data.objects.new(name + "_tyre", me), hub)
    # rim: outer lip ring, recessed dark dish with brake disc, 5 bright spokes, hub cap
    rim_r = R - 0.105
    face = side * 0.07                         # outward face of the wheel
    lip = bmesh.new()
    bmesh.ops.create_cone(lip, cap_ends=False, segments=48, radius1=rim_r, radius2=rim_r, depth=0.05)
    me = bpy.data.meshes.new(name + "_rimlip"); lip.to_mesh(me); lip.free()
    me.materials.append(mats["rim"])
    for p in me.polygons:
        p.use_smooth = True
    lo = link(bpy.data.objects.new(name + "_rimlip", me), hub)
    lo.rotation_euler = (math.pi / 2, 0, 0)
    lo.location = (0, face * 0.85, 0)
    cylinder(name + "_dish", rim_r - 0.01, 0.02, (0, -side * 0.02, 0), mats["rimdark"], hub, verts=40)
    cylinder(name + "_disc", rim_r * 0.72, 0.025, (0, 0.0, 0), mats["trim"], hub, verts=36)
    for k in range(5):
        a = 2 * math.pi * k / 5 + math.pi / 2
        sp = box(f"{name}_spoke{k}", (math.cos(a) * rim_r * 0.5, face * 0.7, math.sin(a) * rim_r * 0.5),
                 (rim_r * 0.98, 0.035, 0.07), mats["rim"], hub, bevel=0.012)
        sp.rotation_euler = (0, -a, 0)
    cylinder(name + "_cap", 0.055, 0.04, (0, face * 0.85, 0), mats["rimdark"], hub, verts=24)
    return hub


def build_car(car_type, out_dir):
    spec = CARS[car_type]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = {
        "body": material("Body", (0.18, 0.18, 0.19), metallic=0.55, rough=0.32),
        "glass": material("Glass", (0.03, 0.04, 0.05), rough=0.08, alpha=0.55),
        "trim": material("Trim", (0.03, 0.03, 0.03), rough=0.6),
        "tyre": material("Tyre", (0.02, 0.02, 0.02), rough=0.85),
        "rim": material("Rim", (0.62, 0.63, 0.66), metallic=0.9, rough=0.25),
        "rimdark": material("RimDark", (0.25, 0.25, 0.27), metallic=0.8, rough=0.3),
        "head": material("LightFront", (0.9, 0.92, 1.0), emit=(0.85, 0.9, 1.0)),
        "tail": material("LightRear", (0.6, 0.02, 0.02), emit=(1.0, 0.08, 0.05)),
        "zone": material("Zone", (0.45, 0.78, 0.61), rough=0.4),
        "bed": material("BedLiner", (0.05, 0.05, 0.05), rough=0.9),
        "wire": material("Wire", (0.8, 0.77, 0.74)),
    }
    root = link(bpy.data.objects.new(f"car_{car_type}", None))
    body, top, belt, half_w = build_body(spec, mats, root)
    L, W, R = spec["L"], spec["W"], spec["R"]
    bf, br = belt(L), belt(0)

    # lights, grille, mirrors, handles: every detail is anchored to the body surface
    nose_z, tail_z = top(L - 0.10), top(0.06)
    for s in (1, -1):
        hl = box(f"headlight_{'l' if s > 0 else 'r'}", (L - 0.07, s * W * 0.31, nose_z - 0.07),
                 (0.10, 0.30, 0.06), mats["head"], root, 0.018)
        hl.rotation_euler = (0, 0.25, s * 0.15)
        tz = min(tail_z - 0.08, br - 0.08)      # below the belt, where the body is full width
        box(f"taillight_{'l' if s > 0 else 'r'}", (0.025, s * (half_w(0.03) - 0.19), tz), (0.06, 0.30, 0.07),
            mats["tail"], root, 0.015)
        mx = spec["windshield"][0] + 0.08
        box(f"mirror_{'l' if s > 0 else 'r'}", (mx, s * (half_w(mx) * 0.95 + 0.07), belt(mx) + 0.06),
            (0.11, 0.12, 0.08), mats["body"], root, 0.025)
        for hx in (spec["xr"] + (spec["xf"] - spec["xr"]) * 0.36, spec["xr"] + (spec["xf"] - spec["xr"]) * 0.68):
            box(f"handle_{s}_{hx:.2f}", (hx, s * (half_w(hx) * 1.004 + 0.006), belt(hx) - 0.07),
                (0.14, 0.02, 0.025), mats["trim"], root, 0.006)
    box("grille", (L - 0.03, 0, nose_z - 0.20), (0.06, W * 0.42, 0.13), mats["trim"], root, 0.02)
    for k in range(3):
        box(f"grille_bar{k}", (L - 0.005, 0, nose_z - 0.245 + k * 0.045), (0.02, W * 0.40, 0.010), mats["rimdark"], root, 0.0)
    box("rear_diffuser", (0.04, 0, spec["floor"] + 0.08), (0.08, W * 0.60, 0.08), mats["trim"], root, 0.02)

    if spec.get("rails"):
        for s in (1, -1):
            y = s * half_w(1.65) * 0.55
            box(f"roof_rail_{s}", (1.65, y, top(1.65) + 0.045), (2.1, 0.035, 0.03), mats["rimdark"], root, 0.012)
            for fx in (0.65, 2.65):           # feet tie the rail to the roof
                box(f"roof_rail_foot_{s}_{fx}", (fx, y, top(fx) + 0.02), (0.08, 0.04, 0.05), mats["rimdark"], root, 0.01)
    if spec.get("bed"):
        b0, b1 = spec["bed"]
        box("bed_opening", ((b0 + b1) / 2, 0, top((b0 + b1) / 2) - 0.01), (b1 - b0 - 0.06, W * 0.72, 0.03), mats["bed"], root, 0.0)
    if spec.get("spoiler"):
        box("spoiler", (0.12, 0, top(0.12) + 0.05), (0.18, W * 0.70, 0.025), mats["trim"], root, 0.008)

    # health zones (the UI recolours these by status)
    # health zones sit inside the body: engine bay between the front axle and the radiator
    xf, xr = spec["xf"], spec["xr"]
    hood = min(top(xf), top(L - 0.6))
    e0, e1 = xf - 0.30, L - 0.62
    ez0, ez1 = R + 0.06, hood - 0.16
    eng = box("zone_engine", ((e0 + e1) / 2, 0, (ez0 + ez1) / 2), (e1 - e0, W * 0.40, ez1 - ez0), mats["zone"], root, 0.03)
    for k in range(4):  # cylinder head bolts
        cylinder(f"zone_engine_cyl{k}", 0.04, 0.035,
                 (eng.location.x - 0.21 + k * 0.14, 0, ez1 + 0.018), mats["zone"], root, verts=16, axis="Z")
    box("zone_battery", (e0 - 0.02, W * 0.28, (ez0 + 0.15 + ez1) / 2), (0.22, 0.16, ez1 - ez0 - 0.15), mats["zone"], root, 0.015)
    rz1 = min(top(L - 0.45), hood) - 0.16
    box("zone_cooling", (L - 0.45, 0, (spec["floor"] + 0.18 + rz1) / 2), (0.04, W * 0.52, rz1 - spec["floor"] - 0.18),
        mats["zone"], root, 0.01)
    box("zone_fuel", (xr + 0.62, 0, spec["floor"] + 0.12), (0.62, W * 0.55, 0.20), mats["zone"], root, 0.05)

    for name, x, s in (("tyre_fl", xf, 1), ("tyre_fr", xf, -1), ("tyre_rl", xr, 1), ("tyre_rr", xr, -1)):
        build_wheel(name, x, s, spec, mats, root)

    root.location = (-L / 2, 0, 0)   # centre the car on the origin, front facing +X

    os.makedirs(out_dir, exist_ok=True)
    blend = os.path.join(out_dir, f"{car_type}.blend")
    glb = os.path.join(out_dir, f"{car_type}.glb")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_apply=True, use_mesh_edges=True)
    render_preview(car_type, spec, out_dir)
    print(f"built {car_type}: {glb}")


def render_preview(car_type, spec, out_dir):
    scn = bpy.context.scene
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scn.collection.objects.link(cam)
    cam.data.lens = 50
    cam.location = (spec["L"] * 0.95, -spec["L"] * 1.15, 1.9)
    target = Vector((0, 0, 0.75))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scn.camera = cam
    scn.render.engine = "BLENDER_WORKBENCH"
    sh = scn.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_cavity = True
    sh.show_object_outline = True
    sh.object_outline_color = (0.95, 0.55, 0.30)
    scn.render.film_transparent = True
    scn.render.resolution_x, scn.render.resolution_y = 960, 540
    scn.render.filepath = os.path.join(out_dir, f"{car_type}.png")
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out_dir = os.path.abspath(argv[0]) if argv else os.path.join(os.path.dirname(__file__), "out")
    for t in (argv[1:] or list(CARS)):
        build_car(t, out_dir)
