import { Navigate } from 'react-router';

export default function RootRedirect() {
  return <Navigate to="/overview" replace />;
}
