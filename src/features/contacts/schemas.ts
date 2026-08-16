import { z } from "zod";

export const contactStatuses = [
  "active",
  "unsubscribed",
  "bounced",
  "invalid",
] as const;

export type ContactStatus = (typeof contactStatuses)[number];

const optionalText = (maximum: number, message: string) =>
  z.preprocess(
    (value) => {
      if (value === undefined) return null;
      return typeof value === "string" && value.trim() === "" ? null : value;
    },
    z.string().trim().max(maximum, message).nullable(),
  );

export const contactSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required")
    .max(100, "First name is too long"),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required")
    .max(100, "Last name is too long"),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .max(320, "Email is too long"),
  company: optionalText(200, "Company is too long"),
  phone: optionalText(50, "Phone number is too long"),
  notes: optionalText(5000, "Notes are too long"),
  status: z.enum(contactStatuses).default("active"),
});

export type ContactInput = z.infer<typeof contactSchema>;

export type ContactActionState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
};

export type CsvImportResult = {
  error?: string;
  imported?: number;
  duplicates?: number;
  invalid?: number;
  invalidRows?: string[];
  batchesCreated?: number;
  contactsBatched?: number;
  batchSize?: number;
  batchIds?: string[];
  batchError?: string;
};
