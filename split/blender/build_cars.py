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
    elif axis == "X":
        ob.rotation_euler = (0, math.pi / 2, 0)
    return link(ob, parent)


# ----------------------------------------------------------------------------- line-art helpers
def V(x, y, z):
    return Vector((x, y, z))


def chaikin(pts, it=2, closed=True):
    """Corner-cutting: rounds a polygon the way a designer's French curve would."""
    for _ in range(it):
        out = []
        n = len(pts)
        rng = range(n) if closed else range(n - 1)
        for i in rng:
            a, b = pts[i], pts[(i + 1) % n]
            out += [tuple(0.75 * a[j] + 0.25 * b[j] for j in range(len(a))),
                    tuple(0.25 * a[j] + 0.75 * b[j] for j in range(len(a)))]
        pts = out if closed else [pts[0]] + out + [pts[-1]]
    return pts


def loop(pts, closed=True):
    pts = [p if isinstance(p, Vector) else Vector(p) for p in pts]
    return [(a, b) for a, b in zip(pts, pts[1:] + ([pts[0]] if closed else []))]


def circle(c, r, u, v, n=32, a0=0.0, a1=2 * math.pi, closed=True):
    pts = [c + r * (math.cos(a0 + (a1 - a0) * k / n) * u + math.sin(a0 + (a1 - a0) * k / n) * v)
           for k in range(n if closed else n + 1)]
    return loop(pts, closed)


def extrude_profile(profile, x0, z0, ys, links=4):
    """Side-view outline (u forward, v up) drawn at each lateral slice y, joined at a few points."""
    pr = chaikin(profile, 2)
    segs = []
    rings = [[V(x0 + u, y, z0 + w) for u, w in pr] for y in ys]
    for r in rings:
        segs += loop(r)
    idx = [round(k * len(pr) / links) % len(pr) for k in range(links)]
    for a, b in zip(rings, rings[1:]):
        segs += [(a[k], b[k]) for k in idx]
    return segs


def tube(path, r=0.018):
    """A pipe or hose drawn as its two outlines (offset in z) plus the centre rings at the ends."""
    segs = []
    for dz in (-r, r):
        segs += loop([p + V(0, 0, dz) for p in path], closed=False)
    return segs


def hull2d(pts):
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


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

    # surface flow: every longitudinal of the loft plus a ring every few stations. Drawn faint and
    # only where the surface faces the viewer, it reads as the panel topology of a CAD model.
    flow = []
    for k in range(RING):
        flow += [(coords[i][k], coords[i + 1][k]) for i in range(ST - 1)]
    for i in range(2, ST - 2, 3):
        flow += [(coords[i][k], coords[i][(k + 1) % RING]) for k in range(RING)]
    wire_mesh("wire_flow", flow, root, mats["wire"])
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
    # tyre wire: tread centre and shoulders, both sidewalls
    tsegs = []
    for j in (0, 1, 13, 3, 11):
        tsegs += [(verts[i][j].co.copy(), verts[(i + 1) % seg][j].co.copy()) for i in range(seg)]
    me = bpy.data.meshes.new(name + "_tyre"); bm.to_mesh(me); bm.free()
    me.materials.append(mats["tyre"])
    for p in me.polygons:
        p.use_smooth = True
    link(bpy.data.objects.new(name + "_tyre", me), hub)

    # rim: outer lip and inner barrel joined by a few lines, ten slim spokes in pairs, hub, lug nuts
    rim_r = R - 0.105
    U, Wv = V(1, 0, 0), V(0, 0, 1)
    fo, bi = side * 0.075, -side * 0.055                    # outer face, inner barrel (wheel-local y)
    tsegs += circle(V(0, fo, 0), rim_r, U, Wv, 48) + circle(V(0, fo, 0), rim_r - 0.02, U, Wv, 48)
    tsegs += circle(V(0, bi, 0), rim_r, U, Wv, 48)
    for k in range(8):
        a = 2 * math.pi * k / 8
        tsegs.append((V(rim_r * math.cos(a), fo, rim_r * math.sin(a)), V(rim_r * math.cos(a), bi, rim_r * math.sin(a))))
    hub_r = 0.07
    tsegs += circle(V(0, fo, 0), hub_r, U, Wv, 24) + circle(V(0, fo + side * 0.01, 0), 0.026, U, Wv, 16)
    for k in range(5):
        a = 2 * math.pi * k / 5 + math.pi / 2
        for d in (-0.16, 0.16):                             # a spoke pair splits towards the rim
            for off in (-0.022, 0.022):
                ca, sa = math.cos(a + off / hub_r), math.sin(a + off / hub_r)
                cb, sb = math.cos(a + d + off / rim_r), math.sin(a + d + off / rim_r)
                tsegs.append((V(hub_r * ca, fo, hub_r * sa), V((rim_r - 0.02) * cb, fo * 0.9, (rim_r - 0.02) * sb)))
        lug = V(0.045 * math.cos(a + 0.6), fo + side * 0.005, 0.045 * math.sin(a + 0.6))
        tsegs += circle(lug, 0.011, U, Wv, 8)
    wire_mesh(name + "_wire", tsegs, hub, mats["wire"])

    # brake: ventilated disc (two faces + hat) and a caliper hugging it at the front-top
    bsegs = []
    rd = rim_r * 0.74
    for y in (-0.012, 0.012):
        bsegs += circle(V(0, y, 0), rd, U, Wv, 40)
    bsegs += circle(V(0, side * 0.02, 0), 0.10, U, Wv, 24)
    cal = [V(r * math.cos(a), side * 0.035, r * math.sin(a))
           for r, a in ((rd - 0.05, 0.35), (rd + 0.02, 0.35), (rd + 0.03, 0.75), (rd + 0.02, 1.15), (rd - 0.05, 1.15),
                        (rd - 0.06, 0.75))]
    bsegs += loop(chaikin([(p.x, p.y, p.z) for p in cal], 1))
    wire_mesh(name + "_brake", bsegs, hub, mats["wire"])
    return hub


# ----------------------------------------------------------------------------- engine bay (health zones)
def build_engine_bay(spec, mats, root, top):
    """An engine you can recognise through the bonnet: block, head, cam cover with coils, intake
    plenum and runners, front-end accessory drive with its belt; radiator with fins and fan;
    battery; fuel tank with filler neck and feed line. Every part is named zone_* so the UI can
    light the whole system up by status."""
    L, W, R, floor = spec["L"], spec["W"], spec["R"], spec["floor"]
    xf, xr = spec["xf"], spec["xr"]
    zm, wm = mats["zone"], mats["wire"]
    hood = min(top(xf), top(L - 0.6))
    e0, e1 = xf - 0.30, L - 0.62
    z0, z1 = R + 0.02, hood - 0.12
    le, h, wb = e1 - e0, z1 - z0, W * 0.42
    xc = (e0 + e1) / 2
    box("zone_engine_block", (xc, 0, z0 + 0.40 * h), (le * 0.78, wb * 0.66, h * 0.48), zm, root, 0)
    box("zone_engine_head", (xc, 0, z0 + 0.73 * h), (le * 0.74, wb * 0.58, h * 0.18), zm, root, 0)
    box("zone_engine_cover", (xc, 0, z0 + 0.88 * h), (le * 0.68, wb * 0.40, h * 0.12), zm, root, 0)
    box("zone_engine_sump", (xc - le * 0.04, 0, z0 + 0.09 * h), (le * 0.58, wb * 0.50, h * 0.16), zm, root, 0)
    for k in range(4):
        cylinder(f"zone_engine_coil{k}", 0.022, 0.05, (xc - le * 0.27 + k * le * 0.18, 0, z0 + 0.96 * h), zm, root, 12, "Z")
    yp = wb * 0.50
    cylinder("zone_engine_plenum", h * 0.10, le * 0.70, (xc, yp, z0 + 0.86 * h), zm, root, 20, "X")
    run = []
    for k in range(4):
        x = xc - le * 0.27 + k * le * 0.18
        zp, zh = z0 + 0.86 * h, z0 + 0.70 * h          # from the plenum, arching over, into the side of the head
        path = [V(x, yp - (yp - wb * 0.30) * t, zp + 0.05 * math.sin(math.pi * t) - (zp - zh) * t)
                for t in (j / 6 for j in range(7))]
        run += tube(path, 0.016)
    wire_mesh("zone_engine_runners", run, root, wm)
    # accessory drive on the front face: crank, water pump, alternator, idler and the belt around them
    xa = e1 - le * 0.06
    pulleys = [(0.0, z0 + 0.24 * h, 0.075), (wb * 0.16, z0 + 0.62 * h, 0.055),
               (-wb * 0.34, z0 + 0.74 * h, 0.045), (-wb * 0.08, z0 + 0.50 * h, 0.03)]
    for k, (y, z, r) in enumerate(pulleys):
        cylinder(f"zone_engine_pulley{k}", r, 0.025, (xa, y, z), zm, root, 28, "X")
    cylinder("zone_engine_alternator", 0.07, 0.11, (xa - 0.075, pulleys[2][0], pulleys[2][1]), zm, root, 24, "X")
    pts = [(y + (r + 0.004) * math.cos(t * math.pi / 18), z + (r + 0.004) * math.sin(t * math.pi / 18))
           for y, z, r in pulleys[:3] for t in range(36)]
    wire_mesh("zone_engine_belt", loop([V(xa + 0.016, y, z) for y, z in hull2d(pts)]), root, wm)
    # exhaust manifold: four primaries curling down on the other side
    exh = []
    for k in range(4):
        x = xc - le * 0.27 + k * le * 0.18
        exh += tube([V(x, -wb * 0.33, z0 + 0.62 * h), V(x, -wb * 0.45, z0 + 0.52 * h),
                     V(xc - le * 0.05 + (k - 1.5) * 0.02, -wb * 0.47, z0 + 0.28 * h)], 0.014)
    wire_mesh("zone_engine_exhaust_manifold", exh, root, wm)

    # cooling: radiator core with fins and tanks, fan behind it, hoses to the engine
    xr_ = L - 0.45
    rz0, rz1 = floor + 0.18, min(top(L - 0.45), hood) - 0.14
    rw = W * 0.52
    box("zone_cooling", (xr_, 0, (rz0 + rz1) / 2), (0.04, rw, rz1 - rz0), zm, root, 0)
    fins = []
    n = int(rw / 0.035)
    for k in range(n + 1):
        y = -rw / 2 + rw * k / n
        fins.append((V(xr_ - 0.021, y, rz0 + 0.03), V(xr_ - 0.021, y, rz1 - 0.03)))
    for z in (rz0 + 0.03, rz1 - 0.03):
        fins.append((V(xr_ - 0.021, -rw / 2, z), V(xr_ - 0.021, rw / 2, z)))
    wire_mesh("zone_cooling_fins", fins, root, wm)
    fr = min((rz1 - rz0) * 0.42, 0.17)
    fc = V(xr_ - 0.07, 0, (rz0 + rz1) / 2)
    fan = circle(fc, fr, V(0, 1, 0), V(0, 0, 1), 36) + circle(fc, 0.04, V(0, 1, 0), V(0, 0, 1), 12)
    for k in range(7):
        a = 2 * math.pi * k / 7
        tip = fc + V(0, fr * 0.92 * math.cos(a + 0.35), fr * 0.92 * math.sin(a + 0.35))
        base = fc + V(0, 0.04 * math.cos(a), 0.04 * math.sin(a))
        mid = fc + V(0, fr * 0.55 * math.cos(a + 0.05), fr * 0.55 * math.sin(a + 0.05))
        fan += loop([base, mid, tip], closed=False)
    wire_mesh("zone_cooling_fan", fan, root, wm)
    hoses = tube([V(xr_ - 0.03, rw * 0.30, rz1 - 0.05), V(e1 + 0.05, rw * 0.22, z0 + 0.80 * h),
                  V(e1 - le * 0.05, wb * 0.16, z0 + 0.72 * h)], 0.018)
    hoses += tube([V(xr_ - 0.03, -rw * 0.30, rz0 + 0.06), V(e1 + 0.06, -rw * 0.18, z0 + 0.22 * h),
                   V(e1 - le * 0.08, -wb * 0.2, z0 + 0.30 * h)], 0.018)
    wire_mesh("zone_cooling_hoses", hoses, root, wm)

    # battery with terminals and a cable
    bx, by, bz = e0 - 0.02, W * 0.29, (z0 + 0.15 + z1) / 2
    bh = z1 - z0 - 0.15
    box("zone_battery", (bx, by, bz), (0.24, 0.17, bh), zm, root, 0)
    for k, dy in enumerate((-0.05, 0.05)):
        cylinder(f"zone_battery_terminal{k}", 0.014, 0.025, (bx + 0.07, by + dy, bz + bh / 2 + 0.012), zm, root, 10, "Z")
    wire_mesh("zone_battery_cable", tube([V(bx + 0.07, by - 0.05, bz + bh / 2 + 0.02), V(bx + 0.18, by - 0.12, bz + bh / 2 + 0.05),
                                          V(e0 + le * 0.2, wb * 0.3, z0 + 0.4 * h)], 0.008), root, wm)

    # fuel: tank under the rear seat, filler neck up to the rear quarter, feed line along the floor
    tx = xr + 0.62
    box("zone_fuel", (tx, 0, floor + 0.13), (0.62, W * 0.55, 0.20), zm, root, 0)
    neck = tube([V(tx - 0.25, -W * 0.27, floor + 0.20), V(xr + 0.05, -W * 0.36, floor + 0.40),
                 V(max(xr - 0.25, 0.25), -W * 0.45, max(R * 2 + 0.05, floor + 0.55))], 0.022)
    wire_mesh("zone_fuel_neck", neck, root, wm)
    wire_mesh("zone_fuel_line", loop([V(tx + 0.31, W * 0.12, floor + 0.05), V(e0, W * 0.12, floor + 0.05),
                                     V(e0 + 0.05, W * 0.10, z0 + 0.5 * h)], closed=False), root, wm)


# ----------------------------------------------------------------------------- interior
def build_interior(spec, mats, root, top, belt, half_w):
    """Seats, steering wheel, dashboard, console and gear lever, as clean line art."""
    W, floor = spec["W"], spec["floor"]
    w1 = spec["windshield"][1]
    segs = []
    xs = w1 - 1.15                                           # front seat hip point
    zh = floor + 0.30
    xr_seat = max(xs - 0.85, spec["glass"][0] + 0.25)
    seats = [(xs, W * 0.22), (xs, -W * 0.22)]
    if xs - xr_seat >= 0.6:
        seats.append((xr_seat, 0.0))

    for x, y in seats:
        bench = y == 0.0
        hw = W * 0.30 if bench else 0.24
        ys = [y - hw, y, y + hw] if bench else [y - hw, y + hw]
        bh = max(0.32, min(0.58, top(x - 0.3) - zh - 0.14))
        lean = bh * 0.22
        cushion = [(-0.22, 0.03), (0.20, 0.07), (0.28, 0.03), (0.28, -0.06), (0.20, -0.11), (-0.22, -0.11)]
        back = [(-0.30, -0.03), (-0.20, 0.02), (-0.10 - lean, bh), (-0.20 - lean, bh + 0.03), (-0.33 - lean, bh - 0.02)]
        segs += extrude_profile(cushion, x, zh, ys, 4) + extrude_profile(back, x, zh, ys, 4)
        if not bench:
            hr = [(-0.25 - lean, bh + 0.06), (-0.16 - lean, bh + 0.07), (-0.17 - lean, bh + 0.21), (-0.27 - lean, bh + 0.20)]
            segs += extrude_profile(hr, x, zh, [y - 0.12, y + 0.12], 2)
            for dy in (-0.07, 0.07):                         # headrest posts
                segs.append((V(x - 0.20 - lean, y + dy, zh + bh + 0.02), V(x - 0.21 - lean, y + dy, zh + bh + 0.07)))

    # steering wheel (right-hand drive: driver on -y), tilted towards the driver, on its column
    t = 0.42
    xw = w1 - 0.62
    c = V(xw, -W * 0.22, belt(xw) - 0.04)
    u, v = V(0, 1, 0), V(math.sin(t), 0, math.cos(t))
    nrm = V(math.cos(t), 0, -math.sin(t))
    segs += circle(c, 0.19, u, v, 40) + circle(c, 0.165, u, v, 40) + circle(c, 0.05, u, v, 16)
    for a in (0.0, math.pi, -math.pi / 2):
        d = math.cos(a) * u + math.sin(a) * v
        perp = math.cos(a + math.pi / 2) * u + math.sin(a + math.pi / 2) * v
        for off in (-0.02, 0.02):
            segs.append((c + 0.05 * d + off * perp, c + 0.168 * d + off * perp))
    segs += loop([c + 0.05 * nrm, c + 0.45 * nrm], closed=False)

    # dashboard: a crowned panel across the car, instrument binnacle in front of the driver, centre screen
    xd = w1 - 0.34
    zd = belt(xd) - 0.22
    dw = half_w(xd) * 0.86
    dash = [(0.0, 0.0), (-0.02, 0.17), (0.06, 0.25), (0.30, 0.24), (0.33, 0.06), (0.20, -0.06), (0.04, -0.06)]
    segs += extrude_profile(dash, xd, zd, [-dw, -W * 0.06, W * 0.06, dw], 5)
    segs += circle(V(xd + 0.04, -W * 0.22, zd + 0.27), 0.13, V(0, 1, 0), V(0, 0, 1), 24, 0.15, math.pi - 0.15, closed=False)
    segs += loop([V(xd + 0.01, -0.13, zd + 0.06), V(xd + 0.01, 0.13, zd + 0.06),
                  V(xd - 0.02, 0.13, zd + 0.20), V(xd - 0.02, -0.13, zd + 0.20)])
    # centre console and gear lever
    xc = xs + 0.25
    for dy in (-0.09, 0.09):
        segs += loop([V(xd, dy, zd - 0.04), V(xc, dy, floor + 0.28), V(xc, dy, floor + 0.08), V(xd, dy, floor + 0.08)])
    for z in (floor + 0.28, floor + 0.08):
        segs.append((V(xc, -0.09, z), V(xc, 0.09, z)))
    g = V(xc + 0.25, 0, floor + 0.28 + 0.4 * (zd - 0.04 - floor - 0.28) * 0.25 / max(xd - xc, 0.3))
    segs += loop([g, g + V(-0.04, 0, 0.16)], closed=False) + circle(g + V(-0.04, 0, 0.185), 0.025, V(1, 0, 0), V(0, 0, 1), 12)
    wire_mesh("interior_lines", segs, root, mats["wire"])


# ----------------------------------------------------------------------------- underbody & small details
def build_underbody(spec, mats, root, top, belt, half_w):
    """Exhaust, drive shafts, coil springs, wipers, number plates, fog lights."""
    L, W, R, floor = spec["L"], spec["W"], spec["R"], spec["floor"]
    xf, xr = spec["xf"], spec["xr"]
    w1 = spec["windshield"][1]
    segs = []
    # exhaust from the manifold back under the floor to a silencer and a tip
    e0 = xf - 0.30
    zp = floor + 0.06
    segs += tube([V(e0 + 0.10, -W * 0.18, R + 0.06), V(e0 - 0.10, -W * 0.16, zp), V(xr + 1.0, -W * 0.14, zp),
                  V(xr + 0.25, -W * 0.20, zp + 0.02), V(0.72, -W * 0.25, zp + 0.04)], 0.022)
    box("exhaust_silencer", (0.52, -W * 0.25, zp + 0.06), (0.40, 0.26, 0.14), mats["trim"], root, 0)
    cylinder("exhaust_tip", 0.035, 0.12, (0.06, -W * 0.27, zp + 0.06), mats["trim"], root, 16, "X")
    # front drive shafts
    for sd in (1, -1):
        segs.append((V(xf, sd * W * 0.10, R + 0.02), V(xf, sd * (W / 2 - 0.22), R)))
        segs += circle(V(xf, sd * (W / 2 - 0.24), R), 0.04, V(1, 0, 0), V(0, 0, 1), 12)
    # coil springs and dampers at each corner
    for x in (xf, xr):
        for sd in (1, -1):
            yc = sd * (W / 2 - 0.34)
            z0, z1 = R + 0.04, R + min(0.36, top(x) - R - 0.25)
            helix = [V(x + 0.055 * math.cos(2 * math.pi * k / 14), yc + 0.055 * math.sin(2 * math.pi * k / 14),
                       z0 + (z1 - z0) * k / 84) for k in range(85)]
            segs += loop(helix, closed=False)
            segs.append((V(x, yc, z0 - 0.06), V(x, yc, z1 + 0.06)))
    # wipers resting on the cowl
    zc = top(w1 + 0.04) + 0.012
    for y0, y1 in ((-W * 0.36, W * 0.02), (W * 0.02, W * 0.36)):
        segs.append((V(w1 + 0.06, y0, zc), V(w1 - 0.02, y1, zc + 0.04)))
    # number plates and fog lights
    pz = top(L - 0.05) - 0.30
    segs += loop([V(L + 0.002, -0.26, pz), V(L + 0.002, 0.26, pz), V(L + 0.002, 0.26, pz + 0.11), V(L + 0.002, -0.26, pz + 0.11)])
    rz = min(top(0.03) - 0.25, belt(0) - 0.25)
    segs += loop([V(-0.002, -0.26, rz), V(-0.002, 0.26, rz), V(-0.002, 0.26, rz + 0.11), V(-0.002, -0.26, rz + 0.11)])
    for sd in (1, -1):
        segs += circle(V(L - 0.01, sd * W * 0.36, floor + 0.20), 0.045, V(0, 1, 0), V(0, 0, 1), 16)
    wire_mesh("detail_lines", segs, root, mats["wire"])


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
    box("grille", (L - 0.03, 0, nose_z - 0.20), (0.06, W * 0.42, 0.13), mats["trim"], root, 0)
    for k in range(3):
        box(f"grille_bar{k}", (L - 0.005, 0, nose_z - 0.245 + k * 0.045), (0.02, W * 0.40, 0.010), mats["rimdark"], root, 0.0)
    box("rear_diffuser", (0.04, 0, spec["floor"] + 0.08), (0.08, W * 0.60, 0.08), mats["trim"], root, 0)

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

    xf, xr = spec["xf"], spec["xr"]
    build_engine_bay(spec, mats, root, top)
    build_interior(spec, mats, root, top, belt, half_w)
    build_underbody(spec, mats, root, top, belt, half_w)

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
