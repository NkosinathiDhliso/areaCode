import jsQR from 'jsqr'
import { useState, useRef, useEffect } from 'react'

import { Box, Text } from '../../shared/components/primitives'
import { api, type ApiError } from '../../shared/lib/api'

type FlowState = 'idle' | 'preview' | 'confirming' | 'result'

interface PreviewData {
  rewardTitle: string
  rewardType: string
  rewardDescription: string
  consumerDisplayName: string
  consumerTier: string
}

interface ResultData {
  success: boolean
  rewardTitle?: string
  redeemedAt?: string
  error?: string
}

export function StaffValidator() {
  const [flowState, setFlowState] = useState<FlowState>('idle')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [result, setResult] = useState<ResultData | null>(null)
  const [scanning, setScanning] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (flowState === 'idle') {
      inputRef.current?.focus()
    }
  }, [flowState])

  // Auto-return to idle after result
  useEffect(() => {
    if (flowState !== 'result') return
    const timer = setTimeout(() => {
      setFlowState('idle')
      setResult(null)
      setCode('')
      setPreview(null)
    }, 3000)
    return () => clearTimeout(timer)
  }, [flowState])

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [])

  function stopCamera() {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current)
      scanIntervalRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setScanning(false)
  }

  function waitForVideoElement(maxWait = 2000): Promise<HTMLVideoElement | null> {
    return new Promise((resolve) => {
      // Use requestAnimationFrame to wait for next paint (React render flush)
      requestAnimationFrame(async () => {
        if (videoRef.current) {
          resolve(videoRef.current)
          return
        }
        // Yield a microtask to allow React to flush state updates
        await Promise.resolve()
        if (videoRef.current) {
          resolve(videoRef.current)
          return
        }
        // If video element still not available, poll until it appears
        const start = Date.now()
        const poll = () => {
          if (videoRef.current) {
            resolve(videoRef.current)
            return
          }
          if (Date.now() - start >= maxWait) {
            resolve(null)
            return
          }
          setTimeout(poll, 50)
        }
        setTimeout(poll, 0)
      })
    })
  }

  async function startCamera() {
    setCameraError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      setScanning(true)

      // Wait for video element to be rendered by React
      const video = await waitForVideoElement()
      if (video && streamRef.current) {
        video.srcObject = streamRef.current
        await video.play()
        startScanning()
      } else {
        setCameraError('Camera failed to initialize. Please try again.')
        stopCamera()
      }
    } catch {
      setCameraError('Camera access denied. Please use manual code entry.')
      setScanning(false)
    }
  }

  function startScanning() {
    // Use BarcodeDetector API if available (Chrome/Edge)
    const BarcodeDetectorAPI = (window as any).BarcodeDetector
    if (BarcodeDetectorAPI) {
      const detector = new BarcodeDetectorAPI({ formats: ['qr_code'] })
      scanIntervalRef.current = setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return
        try {
          const barcodes = await detector.detect(videoRef.current)
          if (barcodes.length > 0) {
            const value = barcodes[0].rawValue
            if (value) {
              stopCamera()
              handleCodeScanned(value)
            }
          }
        } catch {
          // Detection failed, continue scanning
        }
      }, 250)
    } else {
      // Fallback: canvas-based jsQR decoding for Safari/Firefox
      scanIntervalRef.current = setInterval(() => {
        if (!videoRef.current || !canvasRef.current || videoRef.current.readyState < 2) return
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        canvas.width = videoRef.current.videoWidth
        canvas.height = videoRef.current.videoHeight
        ctx.drawImage(videoRef.current, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const qrCode = jsQR(imageData.data, canvas.width, canvas.height)
        if (qrCode?.data) {
          stopCamera()
          handleCodeScanned(qrCode.data)
        }
      }, 300)
    }
  }

  function handleCodeScanned(scannedCode: string) {
    // Extract code from URL if it's a full URL, otherwise use as-is
    const match = scannedCode.match(/\/qr\/[^/]+\/([a-zA-Z0-9]+)/)
    const extractedCode = match ? match[1]! : scannedCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    setCode(extractedCode)
    handlePreview(extractedCode)
  }

  async function handlePreview(previewCode?: string) {
    const targetCode = previewCode ?? code
    if (!targetCode || loading) return
    setLoading(true)
    try {
      const res = await api.get<PreviewData>(`/v1/staff/redeem/${encodeURIComponent(targetCode)}/preview`)
      setPreview(res)
      setFlowState('preview')
    } catch (err) {
      const apiErr = err as ApiError
      const errorType = apiErr.error ?? apiErr.message ?? 'invalid_code'
      setResult({ success: false, error: errorType })
      setFlowState('result')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    if (!code || loading) return
    setFlowState('confirming')
    setLoading(true)
    try {
      const res = await api.post<{ success: true; rewardTitle: string; redeemedAt: string }>(
        `/v1/staff/redeem/${encodeURIComponent(code)}/confirm`,
      )
      setResult({ success: true, rewardTitle: res.rewardTitle, redeemedAt: res.redeemedAt })
      setFlowState('result')
    } catch (err) {
      const apiErr = err as ApiError
      const errorType = apiErr.error ?? apiErr.message ?? 'invalid_code'
      setResult({ success: false, error: errorType })
      setFlowState('result')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handlePreview()
  }

  function getErrorMessage(error: string): string {
    switch (error) {
      case 'expired_code':
        return 'Code has expired'
      case 'already_redeemed':
        return 'Already redeemed'
      default:
        return 'Invalid code'
    }
  }

  // ─── Result Screen ──────────────────────────────────────────────────────
  if (flowState === 'result' && result) {
    return (
      <Box
        className={`flex flex-col items-center justify-center px-5 py-12 gap-4 min-h-[300px] rounded-2xl mx-5 mt-4 ${
          result.success ? 'bg-[var(--success)]' : 'bg-[var(--danger)]'
        }`}
      >
        <Text className="text-white text-5xl">
          {result.success ? (
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
        </Text>
        <Text className="text-white font-bold text-xl font-[Syne] text-center">
          {result.success ? 'Redeemed!' : 'Failed'}
        </Text>
        {result.success && result.rewardTitle && (
          <Text className="text-white text-sm opacity-90">{result.rewardTitle}</Text>
        )}
        {result.success && result.redeemedAt && (
          <Text className="text-white text-xs opacity-75">{new Date(result.redeemedAt).toLocaleString()}</Text>
        )}
        {!result.success && result.error && (
          <Text className="text-white text-sm opacity-90">{getErrorMessage(result.error)}</Text>
        )}
        <Text className="text-white text-xs opacity-60 mt-2">Returning to scanner...</Text>
      </Box>
    )
  }

  // ─── Preview Screen ─────────────────────────────────────────────────────
  if (flowState === 'preview' && preview) {
    return (
      <Box className="flex flex-col items-center px-5 pt-6 gap-5">
        <Box className="w-full max-w-sm bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5 flex flex-col gap-3">
          <Text className="text-[var(--text-primary)] font-bold text-lg font-[Syne] text-center">
            {preview.rewardTitle}
          </Text>
          {preview.rewardType && (
            <Text className="text-[var(--accent)] text-xs text-center uppercase tracking-wider">
              {preview.rewardType}
            </Text>
          )}
          {preview.rewardDescription && (
            <Text className="text-[var(--text-secondary)] text-sm text-center">{preview.rewardDescription}</Text>
          )}
          <Box className="border-t border-[var(--border)] pt-3 mt-1 flex flex-col items-center gap-1">
            <Text className="text-[var(--text-primary)] font-medium text-sm">{preview.consumerDisplayName}</Text>
            <Text className="text-[var(--text-muted)] text-xs capitalize">{preview.consumerTier}</Text>
          </Box>
        </Box>

        <button
          onClick={handleConfirm}
          disabled={loading}
          className="w-full max-w-sm bg-[var(--success)] text-white font-semibold rounded-xl py-4 text-base transition-all duration-150 active:scale-95 disabled:opacity-50"
        >
          {loading ? 'Confirming...' : 'Confirm Redemption'}
        </button>

        <button
          onClick={() => {
            setFlowState('idle')
            setPreview(null)
            setCode('')
          }}
          className="text-[var(--text-muted)] text-sm"
        >
          Cancel
        </button>
      </Box>
    )
  }

  // ─── Confirming Screen ──────────────────────────────────────────────────
  if (flowState === 'confirming') {
    return (
      <Box className="flex flex-col items-center justify-center px-5 pt-12 gap-4">
        <Text className="text-[var(--text-muted)] text-sm">Processing redemption...</Text>
      </Box>
    )
  }

  // ─── Idle Screen (Scanner + Manual Entry) ───────────────────────────────
  return (
    <Box className="flex flex-col items-center px-5 pt-8 gap-6">
      {/* QR Scanner */}
      {scanning && (
        <Box className="w-full max-w-xs relative rounded-2xl overflow-hidden bg-black aspect-square">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          {/* Viewfinder overlay */}
          <Box className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Box className="w-48 h-48 border-2 border-white rounded-xl opacity-60" />
          </Box>
          <canvas ref={canvasRef} className="hidden" />
          <button
            onClick={stopCamera}
            className="absolute top-2 right-2 bg-black bg-opacity-50 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm"
            aria-label="Close scanner"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </Box>
      )}

      {!scanning && (
        <button
          onClick={startCamera}
          className="w-full max-w-xs bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] font-medium rounded-xl py-4 text-sm transition-all duration-150 active:scale-95 flex items-center justify-center gap-2"
        >
          <span>Scan QR Code</span>
        </button>
      )}

      {cameraError && <Text className="text-[var(--warning)] text-xs text-center max-w-xs">{cameraError}</Text>}

      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        maxLength={8}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
        onKeyDown={handleKeyDown}
        placeholder="--------"
        aria-label="Redemption code"
        className="w-full max-w-xs bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-6 text-center text-3xl tracking-[0.4em] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
      />

      <button
        onClick={() => handlePreview()}
        disabled={loading || code.length < 1}
        className="w-full max-w-xs bg-[var(--accent)] text-white font-semibold rounded-xl py-4 text-base transition-all duration-150 active:scale-95 disabled:opacity-50"
      >
        {loading ? 'Looking up...' : 'Validate'}
      </button>
    </Box>
  )
}
