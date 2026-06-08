#!/usr/bin/env python3
"""iMocha Proposal Generator.

Clones the iMocha master template (.docx), applies client-specific
substitutions and bullet injections to word/document.xml only (with
name-only edits to header*.xml / footer*.xml), then repacks and
validates. All design elements — cover page, fonts, theme, colors,
logos, embedded images, table styles — are preserved by construction
because no other file inside the .docx is ever touched.

Usage:
    python generate_proposal.py \
        --master /mnt/user-data/uploads/<master>.docx \
        --intake /tmp/intake.json \
        --output /mnt/user-data/outputs/iMocha_Proposal_<Customer>_<TA|TM>_DRAFT.docx
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

DOCX_HELPERS = Path("/mnt/skills/public/docx/scripts/office")
UNPACK = DOCX_HELPERS / "unpack.py"
PACK = DOCX_HELPERS / "pack.py"


def unpack_docx(docx_path: Path, dest: Path) -> None:
    """Unpack a .docx. Prefer the docx skill's helper; fallback to zipfile."""
    if UNPACK.exists():
        subprocess.run(
            [sys.executable, str(UNPACK), str(docx_path), str(dest)],
            check=True, capture_output=True,
        )
    else:
        dest.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(docx_path) as z:
            z.extractall(dest)


def pack_docx(src: Path, out_path: Path, original: Path) -> None:
    """Pack a directory into a .docx. Prefer the docx skill's helper."""
    if PACK.exists():
        subprocess.run(
            [sys.executable, str(PACK), str(src), str(out_path),
             "--original", str(original)],
            check=True, capture_output=True,
        )
    else:
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
            for p in src.rglob("*"):
                if p.is_file():
                    z.write(p, p.relative_to(src).as_posix())


def discover_bullet_pattern(doc_xml: str) -> dict:
    """Find an existing bulleted paragraph in the document and capture its
    style (numId, pStyle, font, size) for reuse when injecting new bullets.
    Returns a fallback if no pattern is found."""
    m = re.search(
        r"<w:p\b[^>]*>\s*<w:pPr>(.*?)</w:pPr>",
        doc_xml,
        re.DOTALL,
    )
    fallback = {"num_id": "1", "pStyle": "ListParagraph",
                "font": None, "size": None}

    # Find first paragraph that uses a numId
    for m in re.finditer(r"<w:p\b[^>]*>\s*<w:pPr>(.*?)</w:pPr>",
                         doc_xml, re.DOTALL):
        pPr = m.group(1)
        num_m = re.search(r'<w:numId\s+w:val="(\d+)"', pPr)
        if not num_m:
            continue
        pStyle_m = re.search(r'<w:pStyle\s+w:val="([^"]+)"', pPr)
        font_m = re.search(r'<w:rFonts\s+w:ascii="([^"]+)"', pPr)
        size_m = re.search(r'<w:sz\s+w:val="(\d+)"', pPr)
        return {
            "num_id": num_m.group(1),
            "pStyle": pStyle_m.group(1) if pStyle_m else "ListParagraph",
            "font": font_m.group(1) if font_m else None,
            "size": size_m.group(1) if size_m else None,
        }
    return fallback


def xml_escape(s: str) -> str:
    return (s.replace("&", "&amp;")
             .replace("<", "&lt;")
             .replace(">", "&gt;"))


def build_bullet_para(text: str, pattern: dict) -> str:
    """Build a single bullet paragraph XML using the discovered template
    pattern. Style attributes are matched to whatever the template uses."""
    safe = xml_escape(text)
    font_attr = ""
    size_attr = ""
    if pattern.get("font"):
        f = pattern["font"]
        font_attr = (f'<w:rFonts w:ascii="{f}" w:hAnsi="{f}" w:cs="{f}"/>')
    if pattern.get("size"):
        sz = pattern["size"]
        size_attr = f'<w:sz w:val="{sz}"/><w:szCs w:val="{sz}"/>'
    rPr = (f"<w:rPr>{font_attr}{size_attr}</w:rPr>"
           if (font_attr or size_attr) else "")
    return (
        "<w:p>"
          "<w:pPr>"
            f'<w:pStyle w:val="{pattern["pStyle"]}"/>'
            f'<w:numPr><w:ilvl w:val="0"/>'
            f'<w:numId w:val="{pattern["num_id"]}"/></w:numPr>'
            f"{rPr}"
          "</w:pPr>"
          f"<w:r>{rPr}<w:t xml:space=\"preserve\">{safe}</w:t></w:r>"
        "</w:p>"
    )


def apply_substitutions(xml: str, subs: dict) -> str:
    """Apply token substitutions. Longest keys first so composite tokens
    like 'Customer Name (CUSTOMER NAME)' are handled before 'CUSTOMER NAME'."""
    for key in sorted(subs.keys(), key=len, reverse=True):
        val = subs[key]
        if key in xml:
            xml = xml.replace(key, val)
    return xml


def inject_after_heading(xml: str, heading_text: str, payload_xml: str) -> str:
    """Inject payload_xml as siblings immediately after the paragraph
    containing heading_text. Raises if heading not found."""
    pattern = (r"(<w:p\b[^>]*>(?:(?!</w:p>).)*?"
               + re.escape(heading_text)
               + r".*?</w:p>)")
    m = re.search(pattern, xml, re.DOTALL)
    if not m:
        raise RuntimeError(f"Heading not found in document.xml: {heading_text!r}")
    return xml.replace(m.group(1), m.group(1) + payload_xml, 1)


def build_substitutions(intake: dict) -> dict:
    """Build the placeholder→value substitution table from the intake JSON."""
    cust = intake["customer_display_name"]
    rfp = intake["rfp_name"]
    spoc_name = intake.get("spoc_name") or "[TO PROVIDE: Sales SPOC name]"
    spoc_email = intake.get("spoc_email") or "[TO PROVIDE: Sales SPOC email]"
    subs = {
        # COMPOSITE — must be replaced before individual sub-tokens
        "Customer Name (CUSTOMER NAME)": cust,
        # Individual tokens
        "&lt;RFP Name&gt;": rfp,
        "&lt;Customer Name&gt;": cust,
        "CUSTOMER NAME": cust,
        "&lt;Sales spoc name&gt;": spoc_name,
        "Sales email id": spoc_email,
        "&lt;How we are pleased to provide the solution&gt;":
            intake["exec_summary"]["pleased"],
        "&lt;How we are aligned with customer goals and their requirement&gt;":
            intake["exec_summary"]["aligned"],
        "&lt;How confident we are to deliver value&gt;":
            intake["exec_summary"]["confident"],
        "&lt;How scope is aligned to what iMocha can deliver&gt;":
            intake["scope_intro"],
    }
    for k, v in intake.get("extra_substitutions", {}).items():
        subs[k] = v
    return subs


def verify_only_allowed_changed(unpacked: Path, baseline: Path) -> list:
    """Return list of files that differ. Raises if any unauthorized file changed."""
    allowed = {"word/document.xml"}
    for hf in (unpacked / "word").glob("header*.xml"):
        allowed.add(f"word/{hf.name}")
    for hf in (unpacked / "word").glob("footer*.xml"):
        allowed.add(f"word/{hf.name}")

    changed = []
    for p in unpacked.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(unpacked).as_posix()
        other = baseline / rel
        if not other.exists() or other.read_bytes() != p.read_bytes():
            changed.append(rel)
    unexpected = [c for c in changed if c not in allowed]
    if unexpected:
        raise RuntimeError(
            f"FORBIDDEN: files changed outside the allow-list: {unexpected}"
        )
    return changed


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--master", required=True,
                    help="Path to iMocha master template .docx")
    ap.add_argument("--intake", required=True,
                    help="Path to intake JSON")
    ap.add_argument("--output", required=True,
                    help="Output .docx path")
    ap.add_argument("--work", default="/tmp/imocha_proposal_work",
                    help="Working directory (default: %(default)s)")
    args = ap.parse_args()

    master = Path(args.master)
    intake = json.loads(Path(args.intake).read_text(encoding="utf-8"))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    work = Path(args.work)
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    # 1. Clone the master
    working_docx = work / "working.docx"
    shutil.copyfile(master, working_docx)

    # 2. Unpack (editable + baseline copy for diff)
    unpacked = work / "unpacked"
    baseline = work / "baseline"
    unpack_docx(working_docx, unpacked)
    unpack_docx(working_docx, baseline)

    # 3. Read document.xml and discover the template's bullet pattern
    doc_path = unpacked / "word" / "document.xml"
    xml = doc_path.read_text(encoding="utf-8")
    bullet_pattern = discover_bullet_pattern(xml)
    print(f"[ok] discovered bullet pattern: {bullet_pattern}")

    # 4. Apply substitutions (composite-first ordering enforced internally)
    subs = build_substitutions(intake)
    xml = apply_substitutions(xml, subs)

    # 5. Inject deliverables under "2.1 In scope Key Deliverables"
    deliverables = intake.get("deliverables", [])
    if deliverables:
        bullets_xml = "".join(
            build_bullet_para(d, bullet_pattern) for d in deliverables
        )
        xml = inject_after_heading(
            xml, "2.1 In scope Key Deliverables", bullets_xml,
        )
        print(f"[ok] injected {len(deliverables)} deliverables")

    doc_path.write_text(xml, encoding="utf-8")

    # 6. Name-only edits in header/footer XML
    cust = intake["customer_display_name"]
    rfp = intake["rfp_name"]
    name_subs = {
        "&lt;RFP Name&gt;": rfp,
        "&lt;Customer Name&gt;": cust,
        "CUSTOMER NAME": cust,
    }
    for hfp in (list((unpacked / "word").glob("header*.xml"))
                + list((unpacked / "word").glob("footer*.xml"))):
        t = hfp.read_text(encoding="utf-8")
        orig = t
        for k, v in name_subs.items():
            t = t.replace(k, v)
        if t != orig:
            hfp.write_text(t, encoding="utf-8")
            print(f"[ok] header/footer updated: {hfp.name}")

    # 7. Verify only allowed files changed
    changed = verify_only_allowed_changed(unpacked, baseline)
    print(f"[ok] files modified (all allowed): {sorted(changed)}")

    # 8. Verify no orphan placeholder tokens remain
    remaining = sorted(set(
        re.findall(r"&lt;[^&]{1,80}&gt;", doc_path.read_text(encoding="utf-8"))
    ))
    if remaining:
        print(f"[warn] remaining angle-bracket tokens: {remaining}")

    # 9. Pack
    pack_docx(unpacked, output, master)

    # 10. Final asset check on the packed output
    with zipfile.ZipFile(output) as z:
        names = z.namelist()
        media = sum(1 for n in names if n.startswith("word/media/"))
        has_theme = any(n.startswith("word/theme/") for n in names)
        headers = sum(1 for n in names if "/header" in n and n.endswith(".xml"))
        footers = sum(1 for n in names if "/footer" in n and n.endswith(".xml"))

    summary = {
        "output": str(output),
        "media_files": media,
        "theme_present": has_theme,
        "headers": headers,
        "footers": footers,
        "files_modified": sorted(changed),
        "deliverables_injected": len(deliverables),
    }
    print("\n=== SUMMARY ===")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
