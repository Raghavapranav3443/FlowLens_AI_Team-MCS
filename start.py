"""
FlowLens AI — One-Click Launcher
Run from project root: python start.py
Logs from backend and frontend stream directly into this terminal in real time.
Press Ctrl+C to stop everything.
"""

import subprocess
import sys
import os
import time
import threading
import urllib.request
import webbrowser

# Force UTF-8 output on Windows so emoji don't crash
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
    os.environ["PYTHONIOENCODING"] = "utf-8"

# ── CONFIG ───────────────────────────────────────────────────────────────────
BACKEND_DIR  = "backend"
FRONTEND_DIR = "frontend"
# Ports and host are read from .env — see load_env() below.
# Defaults: BACKEND_HOST=127.0.0.1  BACKEND_PORT=8000  FRONTEND_PORT=3000
# ─────────────────────────────────────────────────────────────────────────────

ROOT = os.path.dirname(os.path.abspath(__file__))

# ── HELPERS ──────────────────────────────────────────────────────────────────

def banner(msg):
    print(f"\n  {'='*52}")
    print(f"   {msg}")
    print(f"  {'='*52}\n")

def ok(msg):   print(f"  ✓  {msg}", flush=True)
def warn(msg): print(f"  !!  {msg}", flush=True)
def info(msg): print(f"      {msg}", flush=True)
def fail(msg):
    print(f"\n  ✗  {msg}\n", flush=True)
    sys.exit(1)

def load_env():
    """Load .env from project root. Returns dict of key/value pairs."""
    env_path = os.path.join(ROOT, ".env")
    if not os.path.exists(env_path):
        warn("No .env file found in project root.")
        info("Create one with:")
        info("  GROQ_API_KEY=your_key_here")
        info("  GEMINI_API_KEY=your_key_here  (fallback — optional)")
        return {}
    vals = {}
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, val = line.partition("=")
                vals[key.strip()] = val.strip().strip('"').strip("'")
    return vals

def check_command(cmd):
    try:
        subprocess.run([cmd, "--version"], capture_output=True, timeout=5)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False

def find_npm():
    if check_command("npm"):
        return "npm"
    for p in [
        os.path.expandvars(r"%ProgramFiles%\nodejs\npm.cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\nodejs\npm.cmd"),
        os.path.expandvars(r"%APPDATA%\npm\npm.cmd"),
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\nodejs\npm.cmd"),
    ]:
        if os.path.exists(p):
            return p
    return None

def ensure_python_venv(backend_path):
    venv_dir = os.path.join(backend_path, "venv")
    if sys.platform == "win32":
        python_exe = os.path.join(venv_dir, "Scripts", "python.exe")
        uvicorn_exe = os.path.join(venv_dir, "Scripts", "uvicorn.exe")
    else:
        python_exe = os.path.join(venv_dir, "bin", "python")
        uvicorn_exe = os.path.join(venv_dir, "bin", "uvicorn")

    if not os.path.exists(venv_dir):
        info("Creating Python virtual environment in backend/venv...")
        subprocess.run([sys.executable, "-m", "venv", "--system-site-packages", venv_dir], check=True)
        ok("Virtual environment created.")

    if not os.path.exists(python_exe):
        fail(f"Virtual environment is corrupted. Please delete {venv_dir} and try again.")

    req_file = os.path.join(ROOT, "requirements.txt")
    if os.path.exists(req_file):
        info("Installing/updating Python requirements...")
        res = subprocess.run([python_exe, "-m", "pip", "install", "-r", req_file, "--quiet"], cwd=ROOT)
        if res.returncode != 0:
            fail("Failed to install Python requirements. Please check your system.")
        ok("Python requirements up to date.")

    if not os.path.exists(uvicorn_exe):
        if check_command("uvicorn"):
            return "uvicorn"
        fail("uvicorn not found after installation.")

    return uvicorn_exe

def backend_healthy():
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{BACKEND_PORT}/health", timeout=2)
        return True
    except:
        return False

def stream_output(proc, prefix, color_code):
    """
    Stream subprocess stdout into this terminal in real time with a coloured prefix.
    Runs in a daemon thread so it never blocks the main thread.
    Colors: 32=green, 34=blue, 35=magenta, 36=cyan
    """
    RESET = "\033[0m"
    COLOR = f"\033[{color_code}m"
    try:
        for line in iter(proc.stdout.readline, b""):
            text = line.decode("utf-8", errors="replace").rstrip()
            if text:
                print(f"{COLOR}[{prefix}]{RESET} {text}", flush=True)
    except:
        pass

def ensure_npm_packages(frontend_path, npm_cmd):
    node_modules = os.path.join(frontend_path, "node_modules")
    package_json = os.path.join(frontend_path, "package.json")
    needs_install = (
        not os.path.exists(node_modules)
        or os.path.getmtime(package_json) > os.path.getmtime(node_modules)
    )
    if needs_install:
        info("node_modules missing or out of date — running npm install...")
        result = subprocess.run(
            [npm_cmd, "install", "--no-audit", "--no-fund"],
            cwd=frontend_path,
            shell=(sys.platform == "win32"),
        )
        if result.returncode != 0:
            fail("npm install failed. Check the output above for errors.")
        ok("npm install complete.")
    else:
        ok("node_modules up to date — skipping npm install.")

# ── MAIN ─────────────────────────────────────────────────────────────────────

processes = []

def kill_all():
    for p in processes:
        try:
            p.terminate()
        except:
            pass

banner("FlowLens AI — Process Intelligence · One-Click Launcher")

# ── STEP 1: LOAD & VALIDATE API KEYS ─────────────────────────────────────────
print("[1/5] Checking API keys and prerequisites...\n")

env_vars       = load_env()
GROQ_API_KEY   = env_vars.get("GROQ_API_KEY", "")
GEMINI_API_KEY = env_vars.get("GEMINI_API_KEY", "")

# Server config — read from .env with fallback to defaults
BACKEND_HOST  = env_vars.get("BACKEND_HOST",  "127.0.0.1")
BACKEND_PORT  = int(env_vars.get("BACKEND_PORT",  "8000"))
FRONTEND_PORT = int(env_vars.get("FRONTEND_PORT", "3000"))

if GROQ_API_KEY:
    ok(f"Groq API key found  ({GROQ_API_KEY[:8]}...)  — primary AI model: Llama 3.3 70B")
else:
    warn("GROQ_API_KEY not set. Add it to .env for best performance.")
    info("  Get a free key at: https://console.groq.com")

if GEMINI_API_KEY:
    ok(f"Gemini API key found ({GEMINI_API_KEY[:8]}...)  — will be used as fallback")
else:
    warn("GEMINI_API_KEY not set. No fallback model available.")
    info("  Get a free key at: https://aistudio.google.com/app/apikey")

if not GROQ_API_KEY and not GEMINI_API_KEY:
    fail("No AI API keys found. Set at least one in your .env file and restart.")

print()

# ── STEP 2: CHECK TOOLS ───────────────────────────────────────────────────────
npm_cmd = find_npm()
if not npm_cmd:
    fail("npm not found. Install Node.js from https://nodejs.org")
ok("npm found.")

backend_path  = os.path.join(ROOT, BACKEND_DIR)
frontend_path = os.path.join(ROOT, FRONTEND_DIR)

if not os.path.exists(backend_path):
    fail(f"Backend folder not found: {backend_path}\nCheck BACKEND_DIR in start.py")
if not os.path.exists(os.path.join(frontend_path, "package.json")):
    fail(f"Frontend package.json not found in: {frontend_path}\nCheck FRONTEND_DIR in start.py")

print("\n[2/5] Checking backend Python environment...")
uvicorn_cmd = ensure_python_venv(backend_path)
ok("Backend Python environment ready.")

# ── STEP 3: FRONTEND DEPS ─────────────────────────────────────────────────────
print("\n[3/5] Checking frontend dependencies...")
ensure_npm_packages(frontend_path, npm_cmd)

# ── STEP 4: BACKEND ───────────────────────────────────────────────────────────
print("\n[4/5] Starting backend (FastAPI + Uvicorn)...")

env_backend = os.environ.copy()
env_backend["GROQ_API_KEY"]   = GROQ_API_KEY
env_backend["GEMINI_API_KEY"] = GEMINI_API_KEY
# Ensure Python output from backend is unbuffered — critical for real-time log streaming
env_backend["PYTHONUNBUFFERED"] = "1"

backend_proc = subprocess.Popen(
    [uvicorn_cmd, "main:app", "--reload", "--host", BACKEND_HOST, "--port", str(BACKEND_PORT)],
    cwd=backend_path,
    env=env_backend,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,   # merge stderr → stdout so both stream through one pipe
    bufsize=0,                  # unbuffered — every byte forwarded immediately
)
processes.append(backend_proc)
threading.Thread(
    target=stream_output,
    args=(backend_proc, "backend", "34"),   # blue
    daemon=True,
).start()
ok("Backend process launched — waiting for it to come online...")

for _ in range(40):
    if backend_healthy():
        break
    if backend_proc.poll() is not None:
        fail("Backend crashed on startup. Check the [backend] logs above.")
    time.sleep(2)
else:
    fail("Backend didn't respond within 80s. Check the [backend] logs above.")

ok(f"Backend online  →  http://127.0.0.1:{BACKEND_PORT}")
ok(f"API docs        →  http://127.0.0.1:{BACKEND_PORT}/docs")

# ── STEP 5: FRONTEND ──────────────────────────────────────────────────────────
print("\n[5/5] Starting frontend (React)...")

env_frontend = os.environ.copy()
env_frontend["BROWSER"] = "none"   # we open the browser ourselves

frontend_proc = subprocess.Popen(
    [npm_cmd, "start"],
    cwd=frontend_path,
    env=env_frontend,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    shell=(sys.platform == "win32"),
    bufsize=0,
)
processes.append(frontend_proc)
threading.Thread(
    target=stream_output,
    args=(frontend_proc, "frontend", "35"),  # magenta
    daemon=True,
).start()
ok("Frontend process launched — React compiling (first run takes ~10s)...")

# Wait for React dev server to be ready (it prints "Compiled successfully" or similar)
time.sleep(10)

# ── ALL UP ────────────────────────────────────────────────────────────────────
print(f"\n[5/5] All services running!\n")
print(f"  \033[32m✓\033[0m  Backend    →  http://127.0.0.1:{BACKEND_PORT}")
print(f"  \033[32m✓\033[0m  Frontend   →  http://localhost:{FRONTEND_PORT}")
print(f"  \033[32m✓\033[0m  API Docs   →  http://127.0.0.1:{BACKEND_PORT}/docs")
print(f"\n  AI Engine: {'Groq (Llama 3.3 70B)' if GROQ_API_KEY else 'Gemini 2.5 Flash (fallback)'}")
print(f"\n  Logs streaming in real time below.")
print(f"  \033[34m[backend]\033[0m = FastAPI   \033[35m[frontend]\033[0m = React")
print(f"  Press Ctrl+C to stop everything.\n")
print(f"  {'-'*52}\n")

webbrowser.open(f"http://localhost:{FRONTEND_PORT}")

try:
    while True:
        if backend_proc.poll() is not None:
            warn("Backend stopped unexpectedly — check [backend] logs above.")
        if frontend_proc.poll() is not None:
            warn("Frontend stopped unexpectedly — check [frontend] logs above.")
        time.sleep(5)
except KeyboardInterrupt:
    print("\n\n  Shutting down all services...\n")
    kill_all()
    print("  Done. Goodbye!\n")
    sys.exit(0)