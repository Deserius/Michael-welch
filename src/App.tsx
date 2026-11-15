import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import TopBar from './components/TopBar';
import ProtectedRoute from './components/ProtectedRoute';
import DisclaimerModal from './components/DisclaimerModal';
import SplashScreen from './pages/SplashScreen';
import Login from './pages/Login';
import RoastStudio from './pages/RoastStudio';
import CreditsPage from './pages/CreditsPage';
import SettingsPage from './pages/SettingsPage';
import HistoryPage from './pages/HistoryPage';
import CheckoutSuccess from './pages/CheckoutSuccess';
import CheckoutCancel from './pages/CheckoutCancel';

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="app-shell">
    <DisclaimerModal />
    <TopBar />
    {children}
    <footer className="footer">
      Da RoastBox! © Hustler Anomalies / Deserius Arte — 18+ Entertainment Only
    </footer>
  </div>
);

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<SplashScreen />} />
            <Route path="/login" element={<Login />} />
            <Route
              path="/studio"
              element={
                <ProtectedRoute>
                  <Shell>
                    <RoastStudio />
                  </Shell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/history"
              element={
                <ProtectedRoute>
                  <Shell>
                    <HistoryPage />
                  </Shell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/credits"
              element={
                <ProtectedRoute>
                  <Shell>
                    <CreditsPage />
                  </Shell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/credits/success"
              element={
                <ProtectedRoute>
                  <Shell>
                    <CheckoutSuccess />
                  </Shell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/credits/cancel"
              element={
                <ProtectedRoute>
                  <Shell>
                    <CheckoutCancel />
                  </Shell>
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Shell>
                    <SettingsPage />
                  </Shell>
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
