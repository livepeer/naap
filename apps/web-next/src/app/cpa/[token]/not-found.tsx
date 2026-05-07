export default function CpaPortalNotFound() {
  return (
    <main
      style={{
        maxWidth: '560px',
        margin: '80px auto',
        padding: '0 24px',
        fontFamily: 'system-ui, sans-serif',
        color: '#111',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '28px', margin: 0 }}>Link expired</h1>
      <p style={{ marginTop: '12px', color: '#374151' }}>
        This CPA access link is no longer valid. Please ask your client to send a new
        invitation from their AgentBook settings.
      </p>
    </main>
  );
}
