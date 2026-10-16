<script lang="ts">
	import * as THREE from 'three'
	import { T, useTask, useThrelte, useScheduler } from '@threlte/core'
	import {
		measurement,
		measureHover,
		measureMode,
		pinnedMeasurements,
		measureLabelViews
	} from '$lib/measure'
	import { chainLabels } from '$lib/measureCore'
	import { isVRMode } from '../stores/sceneStore'

	// 47 M1: the measure chains in the 3D view — the one being drawn (with a dashed rubber band
	// to where the next click would land) and every PINNED one. Lines and dots only: the labels
	// are DOM (MeasureLabels.svelte), placed from the screen positions this component publishes
	// in the RENDER stage, after OrbitControls has moved the camera for the frame. Scene-root,
	// local, never in objectsGroup.

	const { camera, renderer } = useThrelte()
	const { renderStage } = useScheduler()

	const DOT_PX = 9

	type Chain = { id: string; points: number[][]; pinned: boolean }

	/** the hover point while measuring — none while the pointer rests on the last point (a
	 *  0 m preview segment and a "Total" equal to the chain read as a measurement) */
	const hoverPoint = $derived.by(() => {
		const points = $measurement?.points ?? []
		const hover = $measureMode ? $measureHover?.point : null
		if (!hover || !points.length) return null
		const last = points[points.length - 1]
		return Math.hypot(hover[0] - last[0], hover[1] - last[1], hover[2] - last[2]) < 1e-4 ? null : hover
	})
	/** the drawn chain plus the hover point while measuring (the preview segment) */
	const live = $derived.by((): Chain | null => {
		const points = $measurement?.points ?? []
		const hover = hoverPoint
		if (!points.length) return null
		return { id: 'cur', points: hover ? [...points, hover] : points, pinned: false }
	})
	const chains = $derived([
		...$pinnedMeasurements.map((m) => ({ id: m.id, points: m.points, pinned: true })),
		...(live ? [live] : [])
	] as Chain[])

	function lineOf(points: number[][]) {
		return new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])))
	}

	// one geometry per chain for the solid part, plus the preview segment; rebuilt only when a
	// chain changes (a click, a pin, the throttled hover) and disposed with it
	const solid = $derived(
		chains.map((c) => {
			const fixed = c.pinned ? c.points : ($measurement?.points ?? [])
			return { id: c.id, pinned: c.pinned, line: lineOf(fixed), dots: lineOf(fixed) }
		})
	)
	const preview = $derived.by(() => {
		const points = $measurement?.points ?? []
		const hover = hoverPoint
		if (!points.length || !hover) return null
		const a = points[points.length - 1]
		const geometry = lineOf([a, hover])
		// the dashed material reads `lineDistance`; written here because the geometry is swapped
		// under one Line as the hover moves (computeLineDistances would need the Line)
		const length = Math.hypot(hover[0] - a[0], hover[1] - a[1], hover[2] - a[2])
		geometry.setAttribute('lineDistance', new THREE.Float32BufferAttribute([0, length], 1))
		return geometry
	})
	$effect(() => {
		const built = solid
		return () => built.forEach((s) => (s.line.dispose(), s.dots.dispose()))
	})
	$effect(() => {
		const built = preview
		return () => built?.dispose()
	})

	const projected = new THREE.Vector3()
	const anchor = new THREE.Vector3()
	let published = false

	useTask(
		() => {
			if ($isVRMode || !chains.length) {
				if (published) measureLabelViews.set([])
				published = false
				return
			}
			const cam = camera.current as any
			const element = renderer?.domElement
			if (!cam || !element) return
			const rect = element.getBoundingClientRect()
			const views: any[] = []
			for (const chain of chains) {
				for (const label of chainLabels(chain.points, chain.id)) {
					anchor.set(label.point[0], label.point[1], label.point[2])
					projected.copy(anchor).project(cam)
					if (projected.z >= 1 || projected.z <= -1) continue // behind the camera
					views.push({
						key: label.key,
						kind: label.kind,
						text: label.text,
						pinned: chain.pinned,
						x: rect.left + ((projected.x + 1) / 2) * rect.width,
						y: rect.top + ((1 - projected.y) / 2) * rect.height
					})
				}
			}
			measureLabelViews.set(views)
			published = true
		},
		{ stage: renderStage }
	)
</script>

<!-- tokens-ok-begin: three.js line/point materials drawn in the 3D view (no CSS tokens reach a shader) -->
{#each solid as s (s.id)}
	<T.Line geometry={s.line} renderOrder={997}>
		<T.LineBasicMaterial color={s.pinned ? '#38bdf8' : '#ff6a1a'} depthTest={false} transparent />
	</T.Line>
	<T.Points geometry={s.dots} renderOrder={998}>
		<T.PointsMaterial
			color={s.pinned ? '#38bdf8' : '#ff6a1a'}
			size={DOT_PX}
			sizeAttenuation={false}
			depthTest={false}
			transparent
		/>
	</T.Points>
{/each}
{#if preview}
	<T.Line geometry={preview} renderOrder={997}>
		<T.LineDashedMaterial color="#ff6a1a" dashSize={0.08} gapSize={0.06} depthTest={false} transparent opacity={0.85} />
	</T.Line>
{/if}
<!-- tokens-ok-end -->
