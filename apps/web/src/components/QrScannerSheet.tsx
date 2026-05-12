import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import jsQR from 'jsqr'
import { BottomSheet } from '@area-code/shared/components/BottomSheet'

interface QrScannerSheetProps {
  isOpen: boolean
  onClose: () => void
  /**
   * Called when a QR code is decoded. The raw string could be either:
   * - an areacode.co.za/qr/{nodeId}/{token} URL (from a venue's printed poster),
   * - or any other string, in which case the caller can choose to ignore it.
   */
  onScanned: (raw: string) => void
}

type ScannerState = 'idle' | 'requesting' | 'scanning' | 'denied'

type BarcodeDetectorCtor = new (options: { formats: string[] }) => {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue?: string }>>
}

function getBarcodeDetector(): BarcodeDetectorCtor | null {
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
  return w.BarcodeDetector ?? null
}

export function QrScannerSheet({ isOpen, onClose, onScanned }: QrScannerSheetProps) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [state, setState] = useState<ScannerState>('idle')

  // Start the camera when the sheet opens, stop when it closes.
  useEffect(() => {
    if (!isOpen) {
      stopCamera()
      setState('idle')
      return
    }

    let cancelled = false
    async function start() {
      setState('requesting')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
        setState('scanning')

        const Detector = getBarcodeDetector()
        if (Detector) {
          // Use native BarcodeDetector when available (Chromium)
          const detector = new Detector({ formats: ['qr_code'] })
          scanIntervalRef.current = setInterval(async () => {
            const video = videoRef.current
            if (!video || video.readyState < 2) return
            try {
              const codes = await detector.detect(video)
              const raw = codes[0]?.rawValue
              if (raw) {
                stopCamera()
                onScanned(raw)
              }
            } catch {
              // Transient detection failures are expected; keep scanning.
            }
          }, 250)
        } else {
          // Fallback: use jsQR for browsers without BarcodeDetector (Firefox, older Safari)
          scanIntervalRef.current = setInterval(() => {
            const video = videoRef.current
            const canvas = canvasRef.current
            if (!video || !canvas || video.readyState < 2) return

            const ctx = canvas.getContext('2d', { willReadFrequently: true })
            if (!ctx) return

            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'dontInvert',
            })
            if (code?.data) {
              stopCamera()
              onScanned(code.data)
            }
          }, 300)
        }
      } catch {
        setState('denied')
      }
    }

    void start()
    return () => {
      cancelled = true
      stopCamera()
    }
    // Run once per open/close cycle. Re-running on callback identity changes
    // would needlessly tear down the camera mid-scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  function stopCamera() {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current)
      scanIntervalRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col items-center gap-4 pb-4">
        <h2 className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">
          {t('qr.scanTitle', 'Scan the venue QR code')}
        </h2>
        <p className="text-[var(--text-secondary)] text-xs text-center max-w-[280px]">
          {t('qr.scanHint', 'QR is usually at the counter or entrance.')}
        </p>

        <div className="w-full max-w-xs relative rounded-2xl overflow-hidden bg-black aspect-square">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
          {/* Hidden canvas used by jsQR fallback to extract video frames */}
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-48 border-2 border-white rounded-xl opacity-70" />
          </div>
          {state === 'requesting' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-60 text-white text-xs">
              {t('qr.requesting', 'Requesting camera…')}
            </div>
          )}
          {state === 'denied' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-80 text-white text-xs text-center px-4">
              {t(
                'qr.denied',
                'Camera access denied. Enable camera permission in your browser settings, or open the QR URL directly.',
              )}
            </div>
          )}
        </div>

        <button onClick={onClose} className="text-[var(--text-muted)] text-sm mt-1">
          {t('common.cancel', 'Cancel')}
        </button>
      </div>
    </BottomSheet>
  )
}
