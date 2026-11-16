"""Ajoute un numéro de version à tous les imports du dossier web/ (évite les mélanges
de versions en cache après une mise en ligne). Usage : python3 outils/version-web.py"""
import re, pathlib, time
v = time.strftime("%Y%m%d%H%M")
web = pathlib.Path(__file__).resolve().parent.parent / "web"
pat = re.compile(r'((?:from\s+|import\()\s*["\'])(\.{1,2}/[^"\'?]+\.js)(?:\?v=[^"\']*)?(["\'])')
for f in (web / "js").glob("*.js"):
    s = f.read_text(encoding="utf-8")
    f.write_text(pat.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={v}{m.group(3)}", s), encoding="utf-8")
idx = web / "index.html"
s = idx.read_text(encoding="utf-8")
s = re.sub(r'(js/app\.js|css/app\.css)(\?v=[^"\']*)?', lambda m: f"{m.group(1)}?v={v}", s)
idx.write_text(s, encoding="utf-8")
print("version", v)
