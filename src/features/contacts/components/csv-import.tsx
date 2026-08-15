"use client";

import { useRef, useState, useTransition } from "react";
import { Upload, X } from "lucide-react";

import { importContactsCsvAction } from "@/features/contacts/actions";
import { parseContactsFile, type ParsedContactRow } from "@/features/contacts/csv";
import type { CsvImportResult } from "@/features/contacts/schemas";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function CsvImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsedContactRow[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleFileSelected(selectedFile: File | null) {
    if (!selectedFile) return;
    setResult(null);
    if (selectedFile.size > 2 * 1024 * 1024) {
      setFile(selectedFile);
      setPreview([]);
      setPreviewError("Contact files are limited to 2 MB.");
      return;
    }
    const parsed = parseContactsFile(await selectedFile.text(), selectedFile.name);
    setFile(selectedFile);
    setPreview(parsed.rows);
    setPreviewError(parsed.error ?? null);
  }

  function confirmImport() {
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);

    startTransition(async () => {
      const importResult = await importContactsCsvAction(formData);
      setResult(importResult);
      if (!importResult.error) {
        setFile(null);
        setPreview([]);
      }
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    });
  }

  function cancelPreview() {
    setFile(null);
    setPreview([]);
    setPreviewError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const normalized = preview.map((row) => row.email.trim().toLowerCase());
  let missing = 0;
  let invalid = 0;
  let duplicates = 0;
  let valid = 0;
  const seen = new Set<string>();
  for (const email of normalized) {
    if (!email) missing++;
    else if (!emailPattern.test(email)) invalid++;
    else if (seen.has(email)) duplicates++;
    else {
      seen.add(email);
      valid++;
    }
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values"
        className="hidden"
        onChange={(event) => void handleFileSelected(event.target.files?.[0] ?? null)}
      />
      <Button
        variant="secondary"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
      >
        <Upload className="h-4 w-4" />
        Import file
      </Button>

      {file ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Preview import</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Review {file.name} before adding contacts.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={cancelPreview} aria-label="Cancel import">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {previewError ? (
              <div className="mt-4">
                <Alert variant="error">{previewError}</Alert>
              </div>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {[
                    ["Rows", preview.length],
                    ["Ready", valid],
                    ["Duplicates", duplicates],
                    ["Invalid", invalid],
                    ["Missing email", missing],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-slate-50 px-3 py-2">
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="text-lg font-semibold text-slate-900">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">First</th>
                        <th className="px-3 py-2 font-medium">Last</th>
                        <th className="px-3 py-2 font-medium">Email</th>
                        <th className="px-3 py-2 font-medium">Company</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.slice(0, 10).map((row) => (
                        <tr key={`${row.line}-${row.email}`} className="border-t border-slate-100">
                          <td className="px-3 py-2">{row.first_name || "—"}</td>
                          <td className="px-3 py-2">{row.last_name || "—"}</td>
                          <td className="px-3 py-2">{row.email || "Missing"}</td>
                          <td className="px-3 py-2">{row.company || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.length > 10 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Showing 10 of {preview.length} rows.
                  </p>
                ) : null}
              </>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={cancelPreview} disabled={pending}>
                Cancel
              </Button>
              <Button
                onClick={confirmImport}
                disabled={pending || Boolean(previewError) || valid === 0}
              >
                {pending ? "Importing..." : `Import ${valid} contact${valid === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {result?.error ? (
        <Alert variant="error">
          {result.error}
          {result.invalidRows && result.invalidRows.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {result.invalidRows.map((row) => (
                <li key={row}>{row}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      {result && !result.error ? (
        <Alert variant="success">
          Imported {result.imported} contact{result.imported === 1 ? "" : "s"}
          {result.duplicates ? `, skipped ${result.duplicates} duplicate(s)` : ""}
          {result.invalid ? `, ${result.invalid} invalid row(s)` : ""}.
          {result.invalidRows && result.invalidRows.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {result.invalidRows.map((row) => (
                <li key={row}>{row}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
    </div>
  );
}
