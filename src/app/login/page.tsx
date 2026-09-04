import type { Metadata } from "next";
import { signInWithGoogle } from "@/app/actions";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/constants";
import { EmbedSignIn } from "./EmbedSignIn";
import styles from "./login.module.css";

export const metadata: Metadata = { title: "Sign in" };

const FEATURES = [
  { icon: "/icons/Search.png", title: "Discover", text: "Search and filter by app and team." },
  { icon: "/icons/Pencil.png", title: "Fill in", text: "Placeholders become fields. Copy in one click." },
  { icon: "/icons/Collaboration.png", title: "Fork", text: "Make it yours. Variants stay linked." },
  { icon: "/icons/Comment.png", title: "Feedback", text: "Upvote, comment, and see what got fixed." },
];

const ERRORS: Record<string, string> = {
  domain: `That account isn't on ${ALLOWED_EMAIL_DOMAIN}. Sign in with your work Google account.`,
  oauth: "Google sign-in didn't complete. Try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const errorMessage = error ? ERRORS[error] ?? "Sign-in failed. Try again." : null;

  return (
    <main className={styles.page}>
      <div className={styles.grid}>
        <section className={styles.hero}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/Clay_Logo_3D_Blk.png" alt="Clay" className={styles.logo} />
          <div className={styles.copy}>
            <div className="eyebrow-lg">Prompt library</div>
            <h1 className="display-xl">Good prompts, shared once. Used everywhere.</h1>
            <p className={styles.lede}>
              Find a prompt, fill in the blanks, paste it into Town, Claude, ChatGPT or Claygent.
              Fork it when you make it better.
            </p>
          </div>
          <form action={signInWithGoogle} className={`${styles.actions} embed-hide`}>
            <input type="hidden" name="next" value={next ?? "/"} />
            <button type="submit" className="btn btn-primary btn-xl">
              <GoogleMark />
              Continue with Google
            </button>
            {errorMessage ? (
              <div className={styles.error} role="alert">
                {errorMessage}
              </div>
            ) : (
              <div className={styles.note}>Sign in with your @{ALLOWED_EMAIL_DOMAIN} account.</div>
            )}
          </form>
          {/* Inside an iframe (Notion), Google won't run its sign-in flow, so it opens in a tab. */}
          <div className={`${styles.actions} embed-only stack`}>
            <EmbedSignIn googleMark={<GoogleMark />} />
          </div>
        </section>

        <section className={styles.features} aria-label="What you can do">
          {FEATURES.map((f) => (
            <div key={f.title} className={styles.feature}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.icon} alt="" className={styles.featureIcon} />
              <div className={styles.featureTitle}>{f.title}</div>
              <div className={styles.featureText}>{f.text}</div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.8l7.9-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}
