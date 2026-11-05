# ENVELOPE-SCHEMA

Write one UTF-8 JSON object, json.dump(..., indent=1, ensure_ascii=True). All decoded strings must be ASCII and PII-free (no email, phone or contact identifiers). Use the exact program, stage, allocation and worker ids supplied at dispatch. Include a non-empty property naming the outcome covered and model_used naming the actual model. Builders requiring independent verification return NEEDS_VERIFY. Evidence paths name committed artifacts on this transport branch and carry SHA-256 of their bytes. Preserve the brief's fences.

The following is the exact shape validator used by return_ingest.py, with its constants and the controller's allowed result enum. Return ingest additionally checks ASCII, PII, allocation binding and applicable sandbox remote pointers before accepting a result.

```python
PROGRAM_RESULTS = ("COMPLETE", "NEEDS_VERIFY", "VERIFY_PASS", "VERIFY_FAIL",
                   "BLOCKED-RETRYABLE", "BLOCKED-CAPABILITY",
                   "NEEDS_CHAT_RULING", "NEEDS_BRYAN", "DONE")

REQUIRED_STRING_FIELDS = ("program_id", "stage_id", "worker_id",
                          "allocation_id", "result", "summary")

REQUIRED_PRESENT_KEYS = ("boundary", "blocker", "material_exception")

def validate_return_envelope(env, source_name, program_results):
    """Return a list of error strings, each naming the field and the
    required shape. Empty list == the envelope may proceed to the PII
    scan. Never guesses, never coerces -- every failure is named.
    """
    errs = []
    if not isinstance(env, dict):
        return ["%s: envelope is not a JSON object" % source_name]

    for field in REQUIRED_STRING_FIELDS:
        v = env.get(field)
        if not v or not isinstance(v, str):
            errs.append(
                "%s: missing required field %r -- must be a non-empty "
                "string, got %s" % (source_name, field,
                                    "absent" if field not in env
                                    else repr(type(v).__name__)))

    result = env.get("result")
    if isinstance(result, str) and result not in program_results:
        errs.append(
            "%s: field 'result'=%r is not one of the PROGRAM_RESULTS "
            "enum in ops_controller.py: %s"
            % (source_name, result, list(program_results)))

    for key in REQUIRED_PRESENT_KEYS:
        if key not in env:
            errs.append(
                "%s: missing required key %r -- the key must be PRESENT "
                "(an absent key is never legitimate; its value is "
                "type-checked below)" % (source_name, key))
    for key in ("boundary", "blocker"):
        if key in env and not isinstance(env[key], str):
            errs.append(
                "%s: field %r must be a string%s, got %s -- the "
                "controller reads it as text (open_question.boundary / "
                "row blocker), so a list or null is refused here rather "
                "than persisted and applied"
                % (source_name, key,
                   " (empty string allowed)" if key == "blocker" else "",
                   type(env[key]).__name__))
    if isinstance(env.get("boundary"), str) and not env["boundary"]:
        errs.append("%s: field 'boundary' must be a non-empty string"
                    % source_name)
    for key in ("findings", "changed_paths"):
        if key in env and (not isinstance(env[key], list) or not all(
                isinstance(x, str) for x in env[key])):
            errs.append("%s: field %r must be a list of strings"
                        % (source_name, key))
    if "material_exception" in env and not isinstance(
            env["material_exception"], bool):
        errs.append(
            "%s: field 'material_exception' must be a real boolean "
            "true/false flag, got %s" % (source_name,
                                         type(env["material_exception"])
                                         .__name__))

    ev = env.get("evidence")
    if not isinstance(ev, list) or not ev:
        errs.append(
            "%s: field 'evidence' must be a non-empty list of "
            "{\"path\": <str>, \"blob\"|\"sha256\"|\"hash\": <str>} "
            "objects, got %s"
            % (source_name, "empty/absent" if not ev
               else type(ev).__name__))
    else:
        for i, item in enumerate(ev):
            if not isinstance(item, dict):
                errs.append(
                    "%s: evidence[%d] must be an object with 'path' and "
                    "a blob/hash field, got %s"
                    % (source_name, i, type(item).__name__))
                continue
            path_v = item.get("path")
            if not path_v or not isinstance(path_v, str):
                errs.append(
                    "%s: evidence[%d] missing non-empty string 'path'"
                    % (source_name, i))
            blob_v = item.get("blob") or item.get("sha256") or item.get(
                "hash")
            if not blob_v or not isinstance(blob_v, str):
                errs.append(
                    "%s: evidence[%d] missing a non-empty 'blob' / "
                    "'sha256' / 'hash' string field -- evidence must "
                    "name the artifact PATH AND ITS BLOB, not the path "
                    "alone" % (source_name, i))

    if result == "VERIFY_PASS":
        prop = env.get("property")
        if not prop or not isinstance(prop, str):
            errs.append(
                "%s: result=VERIFY_PASS requires a non-empty string "
                "'property' naming what the PASS covers"
                % source_name)
        vb = env.get("verified_blobs")
        if vb is None:
            errs.append(
                "%s: result=VERIFY_PASS requires 'verified_blobs' as a "
                "non-empty {path: sha} dict" % source_name)
        elif not isinstance(vb, dict):
            errs.append(
                "%s: 'verified_blobs' must be a dict of {path: sha}, "
                "got %s -- a list (or any other shape) cannot be "
                "drift-checked against a live re-read at merge time and "
                "is refused here rather than bound and failing "
                "unreachably later" % (source_name,
                                       type(vb).__name__))
        elif not vb:
            errs.append(
                "%s: 'verified_blobs' is present but empty -- a "
                "VERIFY_PASS must name at least one verified path:sha "
                "pair" % source_name)
        else:
            for k, v in vb.items():
                if not isinstance(k, str) or not isinstance(v, str) or \
                        not v:
                    errs.append(
                        "%s: 'verified_blobs' entries must be "
                        "string-path -> non-empty-string-sha; found "
                        "%r -> %r" % (source_name, k, v))
                    break
    return errs
```
