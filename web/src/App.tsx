import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Invitations from './pages/Invitations';
import InvitationDetail from './pages/InvitationDetail';
import Seating from './pages/Seating';
import { useAuth } from './lib/auth';

function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/invitations" element={<Protected><Invitations /></Protected>} />
      <Route path="/invitations/new" element={<Protected><InvitationDetail /></Protected>} />
      <Route path="/invitations/:id" element={<Protected><InvitationDetail /></Protected>} />
      <Route path="/seating" element={<Protected><Seating /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
