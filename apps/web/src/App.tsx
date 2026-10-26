import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { GroupPage, GroupsPage } from './pages/GroupsPage';
import { QueuePage } from './pages/QueuePage';
import { NotFoundPage, RequestPage } from './pages/RequestPage';
import { SubmitPage } from './pages/SubmitPage';

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<QueuePage />} />
        <Route path="/submit" element={<SubmitPage />} />
        <Route path="/requests/:id" element={<RequestPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/groups/:id" element={<GroupPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}
