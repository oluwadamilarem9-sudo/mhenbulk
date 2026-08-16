"use client";

import { useMemo, useState, useTransition } from "react";
import { ClipboardPaste, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { importPastedContactsAction } from "@/features/contacts/actions";
import type { CsvImportResult } from "@/features/contacts/schemas";
import { parsePastedEmails } from "@/features/smart-batching/batching";

type Props = {
  defaultBatchSize: number;
};

export function PasteContacts({ defaultBatchSize }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [batchSize, setBatchSize] = useState(defaultBatchSize);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  const preview = useMemo(() => {
    const parsed = parsePastedEmails(text);
    return {
      total: parsed.total,
      valid: parsed.emails.length,
      invalid: parsed.invalid,
      duplicates: parsed.duplicates,
    };
  }, [text]);

  function importContacts() {
    startTransition(async () => {
      const response = await importPastedContactsAction(text, batchSize);
      setResult(response);
      if (!response.error) {
        setText("");
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <ClipboardPaste className="h-4 w-4" />
        Paste contacts
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Paste Contacts
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Use one email per line or separate addresses with commas or
                  semicolons.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                aria-label="Close paste contacts"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <Textarea
              className="mt-4 min-h-56 font-mono text-sm"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setResult(null);
              }}
              placeholder={"john@example.com\nmary@example.com\ndavid@example.com"}
            />
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Detected", preview.total],
                ["Valid", preview.valid],
                ["Duplicates", preview.duplicates],
                ["Invalid", preview.invalid],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="text-lg font-semibold text-slate-900">{value}</p>
                </div>
              ))}
            </div>

            <label className="mt-4 block max-w-xs text-sm font-medium text-slate-700">
              Batch size
              <Input
                className="mt-1"
                type="number"
                min={1}
                max={1000}
                value={batchSize}
                onChange={(event) => setBatchSize(Number(event.target.value))}
              />
            </label>

            {result?.error ? (
              <div className="mt-4">
                <Alert variant="error">{result.error}</Alert>
              </div>
            ) : null}
            {result && !result.error ? (
              <div className="mt-4">
                <Alert variant="success">
                  Imported {result.imported ?? 0} contacts and created{" "}
                  {result.batchesCreated ?? 0} Smart Batches.
                  {result.batchError ? ` ${result.batchError}` : ""}
                </Alert>
              </div>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button
                disabled={
                  pending ||
                  preview.valid === 0 ||
                  batchSize < 1 ||
                  batchSize > 1000
                }
                onClick={importContacts}
              >
                {pending ? "Importing..." : "Import valid contacts"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
