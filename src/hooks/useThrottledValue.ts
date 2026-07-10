import { useEffect, useRef, useState } from 'react'

export function useThrottledValue<T>(value: T, delayMs: number) {
  const [throttled, setThrottled] = useState(value)
  const lastUpdated = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const now = Date.now()
    const remaining = delayMs - (now - lastUpdated.current)

    function commit() {
      lastUpdated.current = Date.now()
      setThrottled(value)
    }

    clearTimeout(timeoutRef.current)
    if (remaining <= 0) {
      commit()
      return
    }

    timeoutRef.current = setTimeout(commit, remaining)
    return () => clearTimeout(timeoutRef.current)
  }, [value, delayMs])

  return throttled
}
