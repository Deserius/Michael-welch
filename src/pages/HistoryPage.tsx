import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { useAuth } from '../contexts/useAuth';
import { Link } from 'react-router-dom';

interface Roast {
  id: number;
  subject_name: string;
  persona_ids: string[];
  transcript: { persona_id: string; line: string }[];
  created_at: string;
}

export default function HistoryPage() {
  const { token } = useAuth();
  const [roasts, setRoasts] = useState<Roast[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    apiGet('/roast', token)
      .then((data) => setRoasts(data.roasts || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  if (loading)
    return (
      <div className="empty-state" style={{ minHeight: 200 }}>
        <span className="spinner" /> Loading history…
      </div>
    );

  return (
    <div className="workspace" style={{ gridTemplateColumns: '1fr' }} data-testid="history-page">
      <div className="panel" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
        <h2>📜 Roast History</h2>
        {roasts.length === 0 ? (
          <div className="empty-state">
            No roasts yet.{' '}
            <Link to="/studio" className="link-btn">
              Start roasting →
            </Link>
          </div>
        ) : (
          <div className="history-list">
            {roasts.map((r) => (
              <div key={r.id} className="history-item">
                <div
                  className="history-header"
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                >
                  <div>
                    <div className="history-subject">{r.subject_name || 'Unknown subject'}</div>
                    <div className="history-meta">
                      {r.persona_ids.length} roaster{r.persona_ids.length !== 1 ? 's' : ''} ·{' '}
                      {new Date(r.created_at).toLocaleString()}
                    </div>
                  </div>
                  <span className="history-toggle">{expanded === r.id ? '▲' : '▼'}</span>
                </div>
                {expanded === r.id && (
                  <div className="history-transcript">
                    {r.transcript.map((line, i) => (
                      <div key={i} className="history-line">
                        <span className="history-persona">{line.persona_id}</span>
                        <span className="history-text">{line.line}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
