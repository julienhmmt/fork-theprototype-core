<script lang="ts">
	import { Position, type NodeProps } from '@xyflow/svelte';
	import Socket from './Socket.svelte';
	import NodeWrapper from './NodeWrapper.svelte';
	import { flowValues } from '../../../stores/flowStore';
	import { setNodeData } from '$lib/nodesHandler';
	import { sequences } from '$lib/sequences';
	import { seqTransport } from '$lib/sequencePlayer';
	import { findSequence, END_EVENT } from '$lib/sequenceCore';
	import { openTimeline } from '$lib/timelineOpen';

	// 48 S2: the two Timeline nodes share one card.
	//   playseq    — Play Sequence: trigger in; plays / stops / toggles / restarts a sequence
	//                on EVERY peer from the trigger's shared stamp
	//   onseqevent — On Sequence Event: pulses when a running sequence crosses an EVENT item
	//                (or reaches its end: `end`); blank sequence / event = any
	// The sequence is stored by ID (a rename keeps the wire), and the runtime falls back to
	// a NAME so a node typed by hand still works.
	type $$Props = NodeProps;
	export let id: string;
	export let data;

	$: list = Object.values($sequences).sort((a: any, b: any) =>
		String(a.name).localeCompare(String(b.name))
	);
	$: chosen = findSequence($sequences, data.sequence ?? '');
	$: running = !!(chosen && $seqTransport[chosen.id]?.playing);
	$: pulsing = $flowValues[id] === 1;
	// the event names the chosen sequence (or every sequence) actually has, + `end`
	$: eventNames = [
		...new Set([
			...(chosen ? [chosen] : list).flatMap((s: any) =>
				s.tracks
					.filter((t: any) => t.kind === 'event')
					.flatMap((t: any) => t.items.map((i: any) => i.name))
			),
			END_EVENT
		])
	];
</script>

<NodeWrapper type={data.type} label={data.label}>
	<Socket kind="source" nodeType={data.type} position={Position.Right} />
	{#if data.type === 'playseq'}
		<Socket
			kind="target"
			nodeType={data.type}
			position={Position.Left}
			id="trigger"
			style="top: 34px"
		/>
	{/if}
	<div class="flex w-full flex-col gap-1">
		<label class="flex flex-col">
			<span>sequence</span>
			<select
				class="nodrag nopan"
				data-testid="seq-node-sequence"
				value={chosen?.id ?? data.sequence ?? ''}
				on:change={(e) => setNodeData(id, { sequence: e.currentTarget.value })}
			>
				{#if data.type === 'onseqevent'}<option value="">any sequence</option>{:else}<option
						value="">— choose —</option
					>{/if}
				{#each list as s (s.id)}
					<option value={s.id}>{s.name}</option>
				{/each}
				{#if data.sequence && !chosen}<option value={data.sequence}
						>{data.sequence} (missing)</option
					>{/if}
			</select>
		</label>
		{#if data.type === 'playseq'}
			<label class="flex flex-col">
				<span>on trigger</span>
				<select
					class="nodrag nopan"
					value={data.action ?? 'play'}
					on:change={(e) => setNodeData(id, { action: e.currentTarget.value })}
				>
					<option value="play">play</option>
					<option value="stop">stop</option>
					<option value="toggle">toggle</option>
					<option value="restart">restart</option>
				</select>
			</label>
			<div class="flex items-center gap-2">
				<span
					class="h-2.5 w-2.5 rounded-full"
					style="background: {running ? 'var(--ink-good)' : 'var(--control-off)'}"
				></span>
				<span class="text-text-muted text-[10px]">{running ? 'playing' : 'idle'}</span>
				{#if chosen}
					<button
						class="nodrag nopan text-accent ml-auto text-[10px] underline"
						on:click={() => openTimeline(chosen.id)}>Open in Timeline</button
					>
				{/if}
			</div>
		{:else}
			<label class="flex flex-col">
				<span>event</span>
				<input
					class="nodrag nopan"
					list="seqevent-names-{id}"
					placeholder="any event"
					value={data.event ?? ''}
					on:change={(e) => setNodeData(id, { event: e.currentTarget.value.trim() })}
				/>
				<datalist id="seqevent-names-{id}">
					{#each eventNames as name (name)}
						<option value={name}></option>
					{/each}
				</datalist>
			</label>
			<div class="flex items-center gap-2">
				<span
					class="h-2.5 w-2.5 rounded-full"
					style="background: {pulsing ? 'var(--ink-good)' : 'var(--control-off)'}"
				></span>
				<span>{pulsing ? 'event!' : 'idle'}</span>
			</div>
			<p class="text-text-muted text-[10px]">
				pulses on every peer as the sequence crosses the event; "end" = it finished
			</p>
		{/if}
	</div>
</NodeWrapper>
