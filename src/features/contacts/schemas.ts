import { z } from "zod";

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
};
