"""Loader shim: GROWW canonical shared module (classification + helpers).

The real module lives at api/_lib/pulse_shared.py and is shared verbatim by the
Vercel serverless functions and this local pipeline. This file exists only so
local scripts (scripts/1..6, serve_dashboard) keep their existing imports.
"""
import importlib.util
import os
import sys

_canon = os.path.join(os.path.dirname(os.path.dirname(__file__)), "api", "_lib", "pulse_shared.py")
_spec = importlib.util.spec_from_file_location("_canon_pulse_shared", _canon)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
sys.modules["pulse_shared"] = _mod
sys.modules[__name__] = _mod