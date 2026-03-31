import { View, Text, Image, StyleSheet } from 'react-native'
import { colors } from '../theme'

interface AvatarCircleProps {
  url: string | null
  displayName: string
  size?: number
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

export function AvatarCircle({ url, displayName, size = 40 }: AvatarCircleProps) {
  const fontSize = size * 0.35

  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]}
        accessibilityLabel={displayName}
      />
    )
  }

  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={[styles.initials, { fontSize }]}>{getInitials(displayName)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  image: { resizeMode: 'cover' },
  fallback: {
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { color: colors.textSecondary, fontWeight: '500' },
})
