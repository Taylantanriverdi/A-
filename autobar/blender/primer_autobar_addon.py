"""PRIMER AUTO BAR — Blender eklentisi.

Blender içinde:
  1. Restorasyon (full-arch hibrit protez) mesh'ini seç.
  2. Her implant için bir Empty ekle: konumu = MUA/implant platform merkezi,
     yerel Z ekseni = implant ekseni (platformdan protezin okluzaline doğru),
     adı = diş numarası (ör. "36" ya da "Implant_36").
  3. "Barı Oluştur" -> bar, kesilmiş hibrit restorasyon ve QA raporu sahneye gelir.

Hesaplama, Blender dışındaki Python'da (trimesh/manifold3d/scipy kurulu) çalışan
`primer_autobar` paketiyle yapılır. Birim: 1 Blender birimi = 1 mm.
"""

bl_info = {
    "name": "PRIMER AUTO BAR",
    "author": "Primer",
    "version": (1, 0, 0),
    "blender": (3, 6, 0),
    "location": "3D Görünüm > Kenar Çubuğu (N) > AutoBar",
    "description": "Implant üstü full-arch hibrit protezden otomatik titanyum bar",
    "category": "Mesh",
}

import json
import os
import re
import struct
import subprocess
import tempfile

import bpy
import numpy as np
from mathutils import Vector


# ---------------------------------------------------------------- STL I/O
def write_stl(path, obj, depsgraph):
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    mesh.calc_loop_triangles()
    mw = obj.matrix_world
    verts = [mw @ v.co for v in mesh.vertices]
    with open(path, "wb") as fh:
        fh.write(b"\0" * 80)
        fh.write(struct.pack("<I", len(mesh.loop_triangles)))
        for tri in mesh.loop_triangles:
            a, b, c = (verts[i] for i in tri.vertices)
            n = (b - a).cross(c - a).normalized()
            fh.write(struct.pack("<12fH", *n, *a, *b, *c, 0))
    ev.to_mesh_clear()


def read_stl(path, name, collection):
    with open(path, "rb") as fh:
        data = fh.read()
    n = struct.unpack("<I", data[80:84])[0]
    if 84 + n * 50 == len(data):
        rec = np.frombuffer(data, dtype=np.dtype([("n", "<f4", (3,)), ("v", "<f4", (9,)), ("a", "<u2")]),
                            count=n, offset=84)
        tri = rec["v"].reshape(-1, 3).astype(np.float64)
    else:  # ASCII
        tri = np.array([[float(x) for x in l.split()[1:4]] for l in data.decode().splitlines()
                        if l.strip().startswith("vertex")])
    uniq, inv = np.unique(np.round(tri, 6), axis=0, return_inverse=True)
    faces = inv.reshape(-1, 3)
    me = bpy.data.meshes.new(name)
    me.from_pydata(uniq.tolist(), [], faces.tolist())
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    return ob


# ---------------------------------------------------------------- properties
class AutoBarSettings(bpy.types.PropertyGroup):
    restoration: bpy.props.PointerProperty(
        name="Restorasyon", type=bpy.types.Object, poll=lambda self, o: o.type == "MESH")
    implants: bpy.props.PointerProperty(name="İmplantlar", type=bpy.types.Collection)
    python_exe: bpy.props.StringProperty(
        name="Python", default="python3" if os.name != "nt" else "python",
        description="trimesh, manifold3d, scipy kurulu Python yorumlayıcısı")
    package_dir: bpy.props.StringProperty(
        name="Paket klasörü", subtype="DIR_PATH",
        default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        description="İçinde primer_autobar/ klasörü bulunan 'autobar' klasörü")

    bar_width: bpy.props.FloatProperty(name="Bar genişliği", default=3.5, min=1.5, max=8, unit="NONE")
    bar_height: bpy.props.FloatProperty(name="Bar yüksekliği", default=4.0, min=1.5, max=8)
    min_cover: bpy.props.FloatProperty(name="Min. restorasyon örtüsü", default=2.0, min=0.3, max=5)
    min_ti_thickness: bpy.props.FloatProperty(name="Min. Ti kalınlık", default=1.2, min=0.3, max=4)
    sleeve_diameter: bpy.props.FloatProperty(name="Silindir çapı", default=5.0, min=3, max=8)
    channel_diameter: bpy.props.FloatProperty(name="Vida kanalı çapı", default=2.2, min=1, max=4)
    seat_diameter: bpy.props.FloatProperty(name="Vida başı yuvası çapı", default=3.0, min=0, max=5)
    max_cantilever: bpy.props.FloatProperty(name="Maks. kantilever", default=15.0, min=0, max=25)
    cantilever_ap_ratio: bpy.props.FloatProperty(name="Kantilever / A-P", default=1.5, min=0, max=3)
    cement_gap: bpy.props.FloatProperty(name="Siman aralığı", default=0.05, min=0, max=0.5)
    cut_restoration: bpy.props.BoolProperty(name="Hibrit iç boşluğunu aç", default=True)

    status: bpy.props.StringProperty(default="")
    summary: bpy.props.StringProperty(default="")


PARAM_KEYS = ("bar_width", "bar_height", "min_cover", "min_ti_thickness", "sleeve_diameter",
              "channel_diameter", "seat_diameter", "max_cantilever", "cantilever_ap_ratio", "cement_gap")


def implant_id(name):
    m = re.search(r"\d{2}", name)
    return m.group(0) if m else name


# ---------------------------------------------------------------- operators
class AUTOBAR_OT_add_implant(bpy.types.Operator):
    bl_idname = "autobar.add_implant"
    bl_label = "İmplant ekle (3D imleç)"
    bl_description = "3D imleç konum/yönünde implant ekseni (Empty) ekler; Z ekseni = implant ekseni"
    bl_options = {"REGISTER", "UNDO"}

    tooth: bpy.props.StringProperty(name="Diş no", default="36")

    def invoke(self, context, event):
        return context.window_manager.invoke_props_dialog(self)

    def execute(self, context):
        st = context.scene.autobar
        if st.implants is None:
            col = bpy.data.collections.new("Implantlar")
            context.scene.collection.children.link(col)
            st.implants = col
        cur = context.scene.cursor
        ob = bpy.data.objects.new(f"Implant_{self.tooth}", None)
        ob.empty_display_type = "SINGLE_ARROW"
        ob.empty_display_size = 12.0
        ob.matrix_world = cur.matrix
        st.implants.objects.link(ob)
        return {"FINISHED"}


class AUTOBAR_OT_generate(bpy.types.Operator):
    bl_idname = "autobar.generate"
    bl_label = "Barı Oluştur"
    bl_description = "Restorasyon ve implantlardan titanyum bar üretir, QA raporu oluşturur"

    def execute(self, context):
        st = context.scene.autobar
        if st.restoration is None:
            self.report({"ERROR"}, "Restorasyon mesh'i seçilmedi")
            return {"CANCELLED"}
        empties = [o for o in (st.implants.all_objects if st.implants else []) if o.type == "EMPTY"]
        if len(empties) < 2:
            self.report({"ERROR"}, "İmplant koleksiyonunda en az 2 Empty olmalı")
            return {"CANCELLED"}

        work = tempfile.mkdtemp(prefix="autobar_")
        out = os.path.join(work, "out")
        resto = os.path.join(work, "restoration.stl")
        write_stl(resto, st.restoration, context.evaluated_depsgraph_get())
        imps = []
        for o in empties:
            mw = o.matrix_world
            axis = (mw.to_3x3() @ Vector((0, 0, 1))).normalized()
            imps.append({"id": implant_id(o.name), "platform": list(mw.translation), "axis": list(axis)})
        with open(os.path.join(work, "implants.json"), "w", encoding="utf-8") as fh:
            json.dump({"units": "mm", "implants": imps}, fh, indent=2)
        with open(os.path.join(work, "params.json"), "w", encoding="utf-8") as fh:
            json.dump({k: getattr(st, k) for k in PARAM_KEYS}, fh, indent=2)

        cmd = [st.python_exe, "-m", "primer_autobar", "run", "--restoration", resto,
               "--implants", os.path.join(work, "implants.json"),
               "--params", os.path.join(work, "params.json"), "--out", out]
        if not st.cut_restoration:
            cmd.append("--no-cut")
        env = dict(os.environ)
        pkg = bpy.path.abspath(st.package_dir)
        env["PYTHONPATH"] = pkg + os.pathsep + env.get("PYTHONPATH", "")
        try:
            proc = subprocess.run(cmd, cwd=pkg, env=env, capture_output=True, text=True, timeout=1800)
        except FileNotFoundError:
            self.report({"ERROR"}, f"Python bulunamadı: {st.python_exe}")
            return {"CANCELLED"}
        if not os.path.exists(os.path.join(out, "bar.stl")):
            print(proc.stdout, proc.stderr)
            self.report({"ERROR"}, "Bar üretilemedi: " + (proc.stderr.strip().splitlines() or ["?"])[-1])
            return {"CANCELLED"}

        col = bpy.data.collections.get("AutoBar Sonuç") or bpy.data.collections.new("AutoBar Sonuç")
        if col.name not in context.scene.collection.children:
            context.scene.collection.children.link(col)
        bar = read_stl(os.path.join(out, "bar.stl"), "Ti_Bar", col)
        mat = bpy.data.materials.get("AutoBar_Ti") or bpy.data.materials.new("AutoBar_Ti")
        mat.diffuse_color = (0.55, 0.6, 0.68, 1.0)
        bar.data.materials.append(mat)
        cut = os.path.join(out, "restoration_cut.stl")
        if os.path.exists(cut):
            read_stl(cut, "Hibrit_Kesilmis", col)

        with open(os.path.join(out, "qa_report.json"), encoding="utf-8") as fh:
            rep = json.load(fh)
        with open(os.path.join(out, "qa_report.txt"), encoding="utf-8") as fh:
            txt = fh.read()
        tb = bpy.data.texts.get("AutoBar_QA") or bpy.data.texts.new("AutoBar_QA")
        tb.clear()
        tb.write(txt + f"\nÇıktı klasörü: {out}\n")
        st.status = rep["status"]
        st.summary = rep["summary"]
        self.report({"INFO"} if rep["status"] == "PASS" else {"WARNING"}, rep["summary"][:200])
        return {"FINISHED"}


# ---------------------------------------------------------------- panel
class AUTOBAR_PT_panel(bpy.types.Panel):
    bl_label = "PRIMER AUTO BAR"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "AutoBar"

    def draw(self, context):
        st = context.scene.autobar
        lay = self.layout
        box = lay.box()
        box.label(text="Girdiler")
        box.prop(st, "restoration")
        box.prop(st, "implants")
        box.operator("autobar.add_implant", icon="EMPTY_SINGLE_ARROW")

        box = lay.box()
        box.label(text="Bar")
        for k in ("bar_width", "bar_height", "sleeve_diameter", "channel_diameter", "seat_diameter"):
            box.prop(st, k)
        box = lay.box()
        box.label(text="Safety zone / QA")
        for k in ("min_cover", "min_ti_thickness", "max_cantilever", "cantilever_ap_ratio", "cement_gap",
                  "cut_restoration"):
            box.prop(st, k)

        box = lay.box()
        box.label(text="Ortam")
        box.prop(st, "python_exe")
        box.prop(st, "package_dir")

        lay.operator("autobar.generate", icon="MOD_BUILD")
        if st.status:
            row = lay.row()
            row.alert = st.status != "PASS"
            row.label(text=st.status, icon="CHECKMARK" if st.status == "PASS" else "ERROR")
            for line in [st.summary[i:i + 48] for i in range(0, min(len(st.summary), 480), 48)]:
                lay.label(text=line)
            lay.label(text="Tam rapor: Metin Düzenleyici > AutoBar_QA")


CLASSES = (AutoBarSettings, AUTOBAR_OT_add_implant, AUTOBAR_OT_generate, AUTOBAR_PT_panel)


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)
    bpy.types.Scene.autobar = bpy.props.PointerProperty(type=AutoBarSettings)


def unregister():
    del bpy.types.Scene.autobar
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)


if __name__ == "__main__":
    register()
