import type { Config } from "tailwindcss";

export default {
	// Mörkt är standardtemat (:root); ljust slås på med <html data-theme="light">.
	darkMode: ["selector", ':root:not([data-theme="light"])'],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	// De delade .rq-*-primitiverna (index.css, @layer components) ska alltid finnas med,
	// även när ett klassnamn byggs dynamiskt (t.ex. rq-chip--${tone}) och därför inte kan skannas.
	safelist: [{ pattern: /^rq-/ }],
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
		// Skarpa hörn (designspråk regel 2): hela radius-skalan är 0 så gamla
		// rounded-*-klasser inte återinför hörn. Endast `full` lever kvar för
		// cirklar (avatar, ring, prick, toggle-spår).
		borderRadius: {
			none: 'var(--rq-radius)',
			sm: 'var(--rq-radius)',
			DEFAULT: 'var(--rq-radius)',
			md: 'var(--rq-radius)',
			lg: 'var(--rq-radius)',
			xl: 'var(--rq-radius)',
			'2xl': 'var(--rq-radius)',
			'3xl': 'var(--rq-radius)',
			full: '9999px'
		},
		extend: {
			// De fyra typsnittsrollerna (temafilen 1.1). `sans` följer ui så
			// gamla font-sans-ställen också får Barlow Condensed.
			fontFamily: {
				display: 'var(--rq-font-display)',
				ui: 'var(--rq-font-ui)',
				mono: 'var(--rq-font-mono)',
				logo: 'var(--rq-font-logo)',
				sans: 'var(--rq-font-ui)'
			},
			colors: {
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				sidebar: {
					DEFAULT: 'hsl(var(--sidebar-background) / <alpha-value>)',
					foreground: 'hsl(var(--sidebar-foreground))',
					primary: 'hsl(var(--sidebar-primary))',
					'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
					accent: 'hsl(var(--sidebar-accent))',
					'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
					border: 'hsl(var(--sidebar-border))',
					ring: 'hsl(var(--sidebar-ring))'
				},
				'podium-gold':          'hsl(var(--podium-gold))',
				'podium-gold-border':   'hsl(var(--podium-gold-border))',
				'podium-silver':        'hsl(var(--podium-silver))',
				'podium-silver-border': 'hsl(var(--podium-silver-border))',
				'podium-bronze':        'hsl(var(--podium-bronze))',
				'podium-bronze-border': 'hsl(var(--podium-bronze-border))',
				success: 'hsl(var(--success))'
			},
			keyframes: {
				'accordion-down': {
					from: {
						height: '0'
					},
					to: {
						height: 'var(--radix-accordion-content-height)'
					}
				},
				'accordion-up': {
					from: {
						height: 'var(--radix-accordion-content-height)'
					},
					to: {
					height: '0'
				}
			}
		},
		animation: {
			'accordion-down': 'accordion-down 0.2s ease-out',
			'accordion-up': 'accordion-up 0.2s ease-out'
		}
	}
	},
	plugins: [import('tailwindcss-animate')],
} satisfies Config;