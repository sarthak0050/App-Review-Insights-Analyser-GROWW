"""Loader shim: GROWW note + email generation (Gemini or deterministic).

The real module lives at api/_lib/pulse_generate.py and is shared verbatim by
the Vercel serverless functions and this local pipeline. This file exists only
so local scripts keep their existing imports.
"""
import importlib.util
import os
import sys

_lib = os.path.join(os.path.dirname(os.path.dirname(__file__)), "api", "_lib")
sys.path.insert(0, _lib)
_canon = os.path.join(_lib, "pulse_generate.py")
_spec = importlib.util.spec_from_file_location("_canon_pulse_generate", _canon)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
sys.modules["pulse_generate"] = _mod
sys.modules[__name__] = _mod