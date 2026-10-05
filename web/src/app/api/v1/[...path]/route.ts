import { auth } from "@/lib/auth/server";

export const { GET, POST, PUT, PATCH, DELETE } = auth.api;

export const dynamic = "force-dynamic";
