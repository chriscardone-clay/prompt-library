import { createFlagsDiscoveryEndpoint, getProviderData } from "flags/next";
import { enablementApproved, mcpConnector, workflowsBeta } from "@/lib/flags";

/**
 * Lets the Vercel Toolbar's Flags Explorer list these flags and override them
 * for your own browser (opt yourself in or out without changing anyone
 * else's). Needs FLAGS_SECRET; the endpoint verifies the toolbar's token with it.
 */
export const GET = createFlagsDiscoveryEndpoint(() => getProviderData({ workflowsBeta, enablementApproved, mcpConnector }));
