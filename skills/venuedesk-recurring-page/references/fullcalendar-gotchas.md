# FullCalendar v6 — Known Gotchas for VenueDesk

## dateClick silently does nothing

**Cause**: The interaction plugin isn't activated.

**Two things both required:**

1. Load the interaction plugin CDN *after* the main bundle:
   ```html
   <script src='https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js'></script>
   <script src='https://cdn.jsdelivr.net/npm/@fullcalendar/interaction@6.1.10/index.global.min.js'></script>
   ```

2. Set `selectable: true` in the Calendar options. Even `selectable: false`
   suppresses plugin activation — remove it entirely or set it to `true`.
   Add `selectMirror: false, unselectAuto: false` to prevent the drag-select
   rectangle appearing while keeping click detection active.

```javascript
new FullCalendar.Calendar(el, {
  selectable: true,
  selectMirror: false,
  unselectAuto: false,
  dateClick: function(info) { /* fires correctly now */ }
})
```

## Event click vs date click

`eventClick` works without the interaction plugin (it's core FullCalendar).
`dateClick` requires the interaction plugin. If event clicks work but date
clicks don't, the interaction plugin is the culprit.

## Calendar renders but has zero height

Usually means the container `<div>` has no height set. `height: 'auto'` in
the Calendar options is the right fix — it makes the calendar grow to fit its
content rather than requiring a fixed pixel height.

## Room filter after render

To filter which events are shown after initial render, use:
```javascript
calendarInstance.getEvents().forEach(ev => {
  ev.setProp('display', (!filterVal || ev.extendedProps.room_name === filterVal) ? 'auto' : 'none');
});
```
Do NOT destroy and recreate the calendar just to filter — it's slow and loses scroll position.

## Destroying and recreating on data refresh

When refreshing booking data (e.g. after a successful submission), it's
acceptable to call `_rbCalInstance.destroy()` and recreate. But pass
`refreshOnly: true` to the init function so it skips the room/event-type
API calls — those don't change between refreshes.
