"""Exact file-patch inventory, mode-aware replay, and guarded reversal.

Replay always writes to a new disposable copy. This module never applies a patch
to either source tree. File bytes and permission bits are part of each pre/postimage.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any

SCHEMA = "golden.patch-integrity.v1"


def _relative(value: Any) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise ValueError("patch path must be a nonempty POSIX relative path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("patch path escapes or aliases the source root")
    return path


def _state(root: Path, rel: PurePosixPath) -> dict:
    target = root.joinpath(*rel.parts)
    probe = root
    for part in rel.parts:
        probe = probe / part
        if probe.is_symlink():
            raise ValueError(f"symlink in patch path is not supported: {rel.as_posix()}")
        if not probe.exists():
            return {"exists": False}
    if not target.is_file():
        raise ValueError(f"patch path is not a regular file: {rel.as_posix()}")
    mode = stat.S_IMODE(target.stat().st_mode)
    return {"exists": True, "sha256": hashlib.sha256(target.read_bytes()).hexdigest(), "mode": mode}


def _tree(root: Path) -> dict[str, dict]:
    root = Path(root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("source root must be a directory")
    states: dict[str, dict] = {}
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"symlink in source tree is not supported: {path.relative_to(root).as_posix()}")
        if path.is_file():
            rel = path.relative_to(root).as_posix()
            states[rel] = {"exists": True, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                           "mode": stat.S_IMODE(path.stat().st_mode)}
        elif not path.is_dir():
            raise ValueError(f"special file in source tree is not supported: {path.relative_to(root).as_posix()}")
    return states


def tree_digest(root: Path) -> str:
    payload = json.dumps(_tree(root), sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def build_patch_manifest(before_root: Path, after_root: Path) -> dict:
    before_root = Path(before_root).resolve(strict=True)
    after_root = Path(after_root).resolve(strict=True)
    before, after = _tree(before_root), _tree(after_root)
    changed = []
    for rel in sorted(set(before) | set(after)):
        old, new = before.get(rel, {"exists": False}), after.get(rel, {"exists": False})
        if old != new:
            changed.append({"path": rel, "before": old, "after": new})
    return {"schema": SCHEMA, "files": changed,
            "before_tree_sha256": _digest_tree_states(before),
            "after_tree_sha256": _digest_tree_states(after),
            "patch_sha256": hashlib.sha256(json.dumps(changed, sort_keys=True, separators=(",", ":")).encode()).hexdigest()}


def _digest_tree_states(states: dict[str, dict]) -> str:
    payload = json.dumps(states, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _validate_manifest(manifest: Any) -> list[dict]:
    if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA or not isinstance(manifest.get("files"), list) or not manifest["files"]:
        raise ValueError(f"manifest must use {SCHEMA} and contain changed files")
    normalized = []
    seen = set()
    for item in manifest["files"]:
        if not isinstance(item, dict) or set(item) != {"path", "before", "after"}:
            raise ValueError("each manifest entry must contain only path, before, and after")
        rel = _relative(item["path"]).as_posix()
        if rel in seen:
            raise ValueError(f"duplicate patch path: {rel}")
        seen.add(rel)
        for state in (item["before"], item["after"]):
            if not isinstance(state, dict) or state.get("exists") not in (True, False):
                raise ValueError(f"invalid preimage/postimage state: {rel}")
            if state["exists"]:
                if set(state) != {"exists", "sha256", "mode"} or not isinstance(state["sha256"], str) or len(state["sha256"]) != 64 or any(c not in "0123456789abcdef" for c in state["sha256"]):
                    raise ValueError(f"file state requires exact SHA-256 and mode: {rel}")
                if type(state["mode"]) is not int or state["mode"] < 0 or state["mode"] > 0o7777:
                    raise ValueError(f"file permission mode is invalid: {rel}")
            elif set(state) != {"exists"}:
                raise ValueError(f"absent file state cannot carry bytes or mode: {rel}")
        normalized.append({"path": rel, "before": item["before"], "after": item["after"]})
    if [x["path"] for x in normalized] != sorted(seen):
        raise ValueError("manifest entries must be sorted by path")
    for key in ("before_tree_sha256", "after_tree_sha256", "patch_sha256"):
        value = manifest.get(key)
        if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
            raise ValueError(f"manifest {key} must be a lowercase SHA-256")
    expected_patch = hashlib.sha256(json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if expected_patch != manifest["patch_sha256"]:
        raise ValueError("manifest patch digest mismatch")
    return normalized


def verify_patch_manifest(manifest: Any, before_root: Path, after_root: Path) -> dict:
    entries = _validate_manifest(manifest)
    before_root, after_root = Path(before_root).resolve(strict=True), Path(after_root).resolve(strict=True)
    before, after = _tree(before_root), _tree(after_root)
    actual_diff = sorted(rel for rel in set(before) | set(after) if before.get(rel, {"exists": False}) != after.get(rel, {"exists": False}))
    listed = [item["path"] for item in entries]
    if actual_diff != listed:
        raise ValueError("manifest does not cover the complete source-tree diff")
    for item in entries:
        rel = _relative(item["path"])
        if _state(before_root, rel) != item["before"]:
            raise ValueError(f"preimage mismatch: {item['path']}")
        if _state(after_root, rel) != item["after"]:
            raise ValueError(f"postimage mismatch: {item['path']}")
    if _digest_tree_states(before) != manifest["before_tree_sha256"]:
        raise ValueError("complete source preimage tree digest mismatch")
    if _digest_tree_states(after) != manifest["after_tree_sha256"]:
        raise ValueError("complete source postimage tree digest mismatch")
    return {"status": "PASS", "changed_files": len(entries), "patch_sha256": manifest["patch_sha256"],
            "before_tree_sha256": manifest["before_tree_sha256"], "after_tree_sha256": manifest["after_tree_sha256"],
            "permission_modes_included": True, "complete_diff_coverage": True}


def _apply_states(root: Path, source_root: Path, entries: list[dict], direction: str) -> None:
    source_key, target_key = ("before", "after") if direction == "forward" else ("after", "before")
    for item in entries:
        rel = _relative(item["path"])
        expected, target = item[source_key], item[target_key]
        if _state(root, rel) != expected:
            raise ValueError(f"refusing to overwrite diverged file during {direction}: {item['path']}")
    for item in entries:
        rel = _relative(item["path"]); target_state = item[target_key]
        target = root.joinpath(*rel.parts)
        source = source_root.joinpath(*rel.parts)
        if target_state["exists"]:
            source_state = _state(source_root, rel)
            if source_state != target_state:
                raise ValueError(f"payload source does not match {direction} postimage: {item['path']}")
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, temp_name = tempfile.mkstemp(prefix=".golden-patch-", dir=target.parent)
            try:
                with os.fdopen(fd, "wb") as stream:
                    stream.write(source.read_bytes())
                    stream.flush(); os.fsync(stream.fileno())
                os.chmod(temp_name, target_state["mode"])
                os.replace(temp_name, target)
            finally:
                if os.path.exists(temp_name): os.unlink(temp_name)
        elif target.exists():
            target.unlink()
            parent = target.parent
            while parent != root and parent.is_dir() and not any(parent.iterdir()):
                parent.rmdir(); parent = parent.parent


def replay_and_reverse(manifest: Any, before_root: Path, after_root: Path, scratch_root: Path) -> dict:
    """Apply then reverse solely inside a newly created scratch tree."""
    entries = _validate_manifest(manifest)
    before_root, after_root = Path(before_root).resolve(strict=True), Path(after_root).resolve(strict=True)
    scratch_root = Path(scratch_root).resolve(strict=False)
    verify_patch_manifest(manifest, before_root, after_root)
    if scratch_root.exists() or scratch_root.is_symlink():
        raise ValueError("scratch root must be new and empty by nonexistence")
    if scratch_root == before_root or scratch_root == after_root or scratch_root.is_relative_to(before_root) or scratch_root.is_relative_to(after_root):
        raise ValueError("scratch root must be outside both source trees")
    parent = scratch_root.parent
    if not parent.is_dir():
        raise ValueError("scratch parent must already exist")
    shutil.copytree(before_root, scratch_root, copy_function=shutil.copy2)
    if tree_digest(scratch_root) != manifest["before_tree_sha256"]:
        raise ValueError("scratch source copy does not match the complete preimage")
    try:
        _apply_states(scratch_root, after_root, entries, "forward")
        if tree_digest(scratch_root) != manifest["after_tree_sha256"]:
            raise ValueError("replayed candidate differs from the exact postimage tree")
        _apply_states(scratch_root, before_root, entries, "reverse")
        if tree_digest(scratch_root) != manifest["before_tree_sha256"]:
            raise ValueError("reversed tree differs from the exact preimage tree")
        return {"status": "PASS", "patch_sha256": manifest["patch_sha256"],
                "postimage_verified": True, "reversal_verified": True,
                "preimage_tree_restored": True, "unrelated_files_preserved": True,
                "scratch_tree_sha256": tree_digest(scratch_root)}
    except Exception:
        # Preserve failed replay evidence in the scratch tree for inspection.
        raise
