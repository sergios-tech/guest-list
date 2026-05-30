import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Invitations from './pages/Invitations';
import InvitationDetail from './pages/InvitationDetail';
import Seating from './pages/Seating';
import Clients from './pages/admin/Clients';
import ClientMembers from './pages/admin/ClientMembers';
import { useAuth } from './lib/auth';

function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

// Guards: must be authenticated AND isSuperAdmin; otherwise redirect to /login
// or / respectively.  Wraps Layout so super-admin pages share the same shell.
function SuperAdminOnly({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.isSuperAdmin) return <Navigate to="/" replace />;
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
      <Route path="/admin/clients" element={<SuperAdminOnly><Clients /></SuperAdminOnly>} />
      <Route path="/admin/clients/:id/members" element={<SuperAdminOnly><ClientMembers /></SuperAdminOnly>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
