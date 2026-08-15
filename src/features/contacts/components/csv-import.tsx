"use client";

import { useRef, useState, useTransition } from "react";
import { Upload } from "lucide-react";

import { importContactsCsvAction } from "@/features/contacts/actions";
import type { CsvImportResult } from "@/features/contacts/schemas";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function CsvImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  function handleFileSelected(file: File | null) {
    if (!file) return;

    const formData = new FormData();
    formData.set("file", file);

    startTransition(async () => {
      const importResult = await importContactsCsvAction(formData);
      setResult(importResult);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    });
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values"
        className="hidden"
        onChange={(event) => handleFileSelected(event.target.files?.[0] ?? null)}
      />
      <Button
        variant="secondary"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
      >
        <Upload className="h-4 w-4" />
        {pending ? "Importing..." : "Import file"}
      </Button>

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
