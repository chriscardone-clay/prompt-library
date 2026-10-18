import { getProviderData } from "@flags-sdk/vercel";
import { createFlagsDiscoveryEndpoint } from "flags/next";
import { mcpConnector, mcpWrite } from "@/flags";

/**
 * Flags Explorer (Vercel Toolbar) reads flag definitions here. The SDK checks
 * the toolbar's signed request against FLAGS_SECRET, so it's public in the
 * proxy (src/lib/supabase/session.ts) but not open.
 */
export const GET = createFlagsDiscoveryEndpoint(async () => getProviderData({ mcpConnector, mcpWrite }));
