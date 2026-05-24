import { QueryClient } from '@tanstack/react-query';

// Singleton — exported so non-React modules (auth context, axios interceptors)
// can call `.clear()` on logout/401 without having to thread the client
// through React props.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});
