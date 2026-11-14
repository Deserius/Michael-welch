import { Link } from 'react-router-dom';

export default function CheckoutCancel() {
  return (
    <div className="workspace" style={{ gridTemplateColumns: '1fr' }}>
      <div className="panel" style={{ maxWidth: 540, margin: '40px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 48 }}>😕</div>
        <h2>Payment Cancelled</h2>
        <p className="text-muted">No charges were made. You can try again anytime.</p>
        <Link to="/credits" className="btn-secondary" style={{ display: 'inline-block', marginTop: 16 }}>
          Back to Credits
        </Link>
      </div>
    </div>
  );
}
