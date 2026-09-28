import { useNavigationStore } from '@/lib/stores/navigation-store'

export function useNavigation() {
  const store = useNavigationStore()

  return {
    setReturnTo: store.setReturnTo,
    clearReturnTo: store.clearReturnTo,
    getReturnPath: store.getReturnPath,
    returnTo: store.returnTo
  }
}