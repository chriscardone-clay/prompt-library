import Link from "next/link";

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        className="slab-lg"
        style={{
          padding: 48,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          textAlign: "center",
          maxWidth: 480,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/Document.png" alt="" style={{ width: 96, height: 96, objectFit: "contain" }} />
        <div className="display-sm">That prompt isn&apos;t here</div>
        <div className="muted small" style={{ maxWidth: "36ch" }}>
          It may be private, or it was deleted. Head back to the library.
        </div>
        <Link href="/" className="btn btn-primary">
          Back to Discover
        </Link>
      </div>
    </main>
  );
}
