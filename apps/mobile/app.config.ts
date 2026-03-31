import { ExpoConfig, ConfigContext } from 'expo/config'

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Area Code',
  slug: 'area-code',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'areacode',
  userInterfaceStyle: 'dark',
  icon: './assets/icon.png',
  splash: {
    backgroundColor: '#0a0a0f',
  },
  ios: {
    bundleIdentifier: 'co.za.areacode.app',
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Area Code uses your location to check you in at nearby venues and show relevant content.',
    },
    associatedDomains: ['applinks:areacode.co.za'],
  },
  android: {
    package: 'co.za.areacode.app',
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: 'areacode.co.za', pathPrefix: '/node/' },
          { scheme: 'https', host: 'areacode.co.za', pathPrefix: '/qr/' },
          { scheme: 'https', host: 'areacode.co.za', pathPrefix: '/staff-invite/' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins: [
    [
      '@rnmapbox/maps',
      {
        RNMapboxMapsDownloadToken: process.env.MAPBOX_DOWNLOADS_TOKEN,
      },
    ],
    'expo-location',
    'expo-notifications',
    'expo-router',
  ],
  extra: {
    eas: {
      projectId: 'area-code-expo-project-id',
    },
  },
})
