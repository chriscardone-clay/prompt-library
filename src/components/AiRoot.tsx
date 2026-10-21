import { aiSearchEnabled, getCurrentUser } from "@/lib/data";
import { AiProvider } from "./AiAssistant";

/** Mounts Ask AI for signed-in people with the AI_SEARCH flag; everyone else just gets the page. */
export async function AiRoot({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  const enabled = user ? await aiSearchEnabled().catch(() => false) : false;
  return <AiProvider enabled={enabled}>{children}</AiProvider>;
}
