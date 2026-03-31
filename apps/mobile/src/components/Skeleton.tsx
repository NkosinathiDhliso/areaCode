import { View, StyleSheet } from 'react-native'
import { colors } from '../theme'

interface SkeletonBoxProps {
  height?: number
  width?: number | string
}

export function SkeletonBox({ height = 56, width }: SkeletonBoxProps) {
  return (
    <View
      style={[
        styles.skeleton,
        { height },
        width !== undefined ? { width: width as number } : undefined,
      ]}
    />
  )
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: colors.bgRaised,
    borderRadius: 12,
    opacity: 0.6,
  },
})
