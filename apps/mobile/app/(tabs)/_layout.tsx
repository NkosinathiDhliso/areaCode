import { Tabs } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { ConnectivityBanner } from '../../src/components/ConnectivityBanner'
import { View } from 'react-native'
import { colors } from '../../src/theme'

export default function TabsLayout() {
  const { t } = useTranslation()

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgBase }}>
      <ConnectivityBanner />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.bgTabBar,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            height: 56,
            paddingBottom: 4,
          },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarLabelStyle: { fontSize: 10, marginTop: -2 },
        }}
      >
        <Tabs.Screen name="index" options={{ title: t('nav.map'), tabBarLabel: t('nav.map') }} />
        <Tabs.Screen name="rewards" options={{ title: t('nav.rewards'), tabBarLabel: t('nav.rewards') }} />
        <Tabs.Screen name="leaderboard" options={{ title: t('nav.leaderboard'), tabBarLabel: t('nav.leaderboard') }} />
        <Tabs.Screen name="feed" options={{ title: t('nav.feed'), tabBarLabel: t('nav.feed') }} />
        <Tabs.Screen name="profile" options={{ title: t('nav.profile'), tabBarLabel: t('nav.profile') }} />
      </Tabs>
    </View>
  )
}
