import type { ComponentType } from "react";
import { z } from "zod";

// ── Field definition (declarative, no zod visible) ───────────────────

export interface FieldConfig {
  label: string;
  required?: boolean;
  secret?: boolean;
  type?: "number" | "textarea";
  placeholder?: string;
  description?: string;
}

export interface AuthMethodConfig {
  label: string;
  fields?: Record<string, FieldConfig>;
}

export interface DefineTypeInput {
  id: string;
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  fields: Record<string, FieldConfig>;
  auth?: {
    methods: Record<string, AuthMethodConfig>;
  };
}

// ── Output type consumed by RegistryForm ─────────────────────────────

export interface FieldDef {
  name: string;
  label: string;
  required: boolean;
  secret: boolean;
  type: "text" | "number" | "textarea" | "secret";
  placeholder?: string;
  description?: string;
  when?: { field: string; value: string };
}

export interface TypeDef {
  id: string;
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  schema: z.ZodType;
  fields: FieldDef[];
  authDiscriminator?: string;
  authOptions?: { value: string; label: string }[];
}

// ── Builder: one definition → schema + fields ────────────────────────

function configToFieldDef(
  name: string,
  config: FieldConfig,
  when?: { field: string; value: string },
): FieldDef {
  const type = config.secret ? "secret" : config.type === "number" ? "number" : config.type === "textarea" ? "textarea" : "text";
  return {
    name,
    label: config.label,
    required: config.required ?? false,
    secret: config.secret ?? false,
    type,
    placeholder: config.placeholder,
    description: config.description,
    when,
  };
}

function configToZodField(config: FieldConfig): z.ZodType {
  let field: z.ZodType;
  if (config.type === "number") {
    field = z.string(); // stored as string in config, parsed on submit
  } else {
    field = z.string();
  }
  if (config.required) {
    field = (field as z.ZodString).min(1, `${config.label} is required`);
  } else {
    field = field.optional();
  }
  return field;
}

export function defineType(input: DefineTypeInput): TypeDef {
  const fieldDefs: FieldDef[] = [];
  const baseShape: Record<string, z.ZodType> = {};

  // Connection fields (always visible)
  for (const [name, config] of Object.entries(input.fields)) {
    fieldDefs.push(configToFieldDef(name, config));
    baseShape[name] = configToZodField(config);
  }

  // Auth methods
  let schema: z.ZodType;
  let authDiscriminator: string | undefined;
  let authOptions: { value: string; label: string }[] | undefined;

  if (input.auth) {
    const discriminator = "auth_method";
    authDiscriminator = discriminator;
    authOptions = Object.entries(input.auth.methods).map(([value, m]) => ({
      value,
      label: m.label,
    }));

    const variants = Object.entries(input.auth.methods).map(([value, method]) => {
      const variantShape: Record<string, z.ZodType> = {
        ...baseShape,
        [discriminator]: z.literal(value),
      };

      if (method.fields) {
        for (const [name, config] of Object.entries(method.fields)) {
          fieldDefs.push(configToFieldDef(name, config, { field: discriminator, value }));
          variantShape[name] = configToZodField(config);
        }
      }

      return z.object(variantShape);
    });

    schema = z.discriminatedUnion(
      discriminator,
      variants as unknown as [z.ZodObject<z.ZodRawShape>, ...z.ZodObject<z.ZodRawShape>[]],
    );
  } else {
    schema = z.object(baseShape);
  }

  return {
    id: input.id,
    name: input.name,
    description: input.description,
    icon: input.icon,
    schema,
    fields: fieldDefs,
    authDiscriminator,
    authOptions,
  };
}
