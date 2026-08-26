import os, re

print("=" * 60)
print("       NAVIOS / NAVI-PWA CODEBASE & UI AUDIT SCANNER        ")
print("=" * 60)

issues = []

# Scan all frontend source files
for root, _, files in os.walk("."):
    if "node_modules" in root or ".git" in root or ".next" in root: continue
    for f in files:
        if f.endswith((".tsx", ".jsx", ".ts", ".js", ".css")):
            fp = os.path.join(root, f)
            try:
                with open(fp, "r", encoding="utf-8", errors="ignore") as file_obj:
                    lines = file_obj.readlines()
                    for idx, line in enumerate(lines, 1):
                        # 1. Unsafe HTML Injection (XSS / Renderer Crashes)
                        if "dangerouslySetInnerHTML" in line:
                            issues.append((fp, idx, "HIGH", "dangerouslySetInnerHTML detected — ensure markdown/artifact output is properly sanitized with DOMPurify."))

                        # 2. Missing Error Boundaries around dynamic artifacts / iframes
                        if "<iframe" in line and "sandbox" not in line:
                            issues.append((fp, idx, "MEDIUM", "iframe rendered without strict 'sandbox' attributes."))

                        # 3. Unsafe LocalStorage / IndexedDB access (Can crash in private browsing / iOS)
                        if "localStorage.getItem" in line and "try" not in "".join(lines[max(0, idx-5):idx]):
                            issues.append((fp, idx, "LOW", "Direct localStorage call without try/catch block (may crash on iOS Safari Private Mode)."))

                        # 4. Viewport overflow issues on mobile
                        if "overflow-x-hidden" not in line and "w-screen" in line:
                            issues.append((fp, idx, "LOW", "w-screen without overflow-x handling may cause horizontal scroll jitter on mobile."))

                        # 5. Missing safe area padding for iOS standalone mode
                        if "safe-area-inset" not in "".join(lines) and ("navbar" in f.lower() or "header" in f.lower()):
                            issues.append((fp, idx, "LOW", "Header component missing 'env(safe-area-inset-top)' — may collide with iPhone Dynamic Island."))
            except: pass

print(f"\nAudit complete. Found {len(issues)} potential UI / stability issues:\n")
for path, line_no, severity, msg in issues[:25]:
    color_prefix = "[CRITICAL]" if severity == "HIGH" else ("[WARNING]" if severity == "MEDIUM" else "[NOTICE]")
    print(f"{color_prefix} {path}:{line_no}")
    print(f"   -> {msg}\n")

if not issues:
    print("✓ No major static code vulnerabilities detected!")
print("=" * 60)
