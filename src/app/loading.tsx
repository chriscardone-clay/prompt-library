export default function Loading() {
  return (
    <div className="container" aria-busy="true" aria-label="Loading">
      <div style={{ height: 72 }} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 16,
          paddingTop: 24,
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="slab"
            style={{ minHeight: 220, opacity: 0.6, animation: "pulse 1.4s ease-in-out infinite" }}
          />
        ))}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:.5}50%{opacity:.85}}`}</style>
    </div>
  );
}
