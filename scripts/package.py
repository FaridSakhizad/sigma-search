"""Create a reproducible beta archive containing only extension runtime files."""

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parent.parent
manifest = json.loads((ROOT / "manifest.json").read_text())
output = ROOT / "dist" / f"sigma-search-{manifest['version']}-beta.zip"
files = [ROOT / "manifest.json", ROOT / "LICENSE"]
for folder, suffixes in {
    "src": {".js", ".html", ".css"},
    "assets": {".png", ".svg", ".webp", ".ico", ".jpg", ".jpeg"},
}.items():
    files.extend(
        path for path in (ROOT / folder).rglob("*")
        if path.is_file() and path.suffix.lower() in suffixes
        and not any(part.startswith(".") for part in path.relative_to(ROOT).parts)
    )

output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
    for path in sorted(files):
        entry = ZipInfo(path.relative_to(ROOT).as_posix(), date_time=(2024, 1, 1, 0, 0, 0))
        entry.compress_type = ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, path.read_bytes())
print(output)
