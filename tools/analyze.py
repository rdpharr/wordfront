"""Analyse Wordfront gameplay logs with DuckDB.

Loads every run log (JSON Lines) into tables (runs, waves, enemies, keystrokes)
and prints the measures the spec asks for: difficulty curve, pacing, fairness,
word quality and engagement, with runs grouped by config hash so each tuning
change can be compared with the runs before it.

    uv run --with duckdb tools/analyze.py                  # %APPDATA%/Wordfront/logs
    uv run --with duckdb tools/analyze.py path/to/logs     # another folder
    uv run --with duckdb tools/analyze.py --config 1a2b3c4d
    uv run --with duckdb tools/analyze.py --save runs.duckdb   # keep the tables
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import duckdb


def default_logs() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    return Path(base) / "Wordfront" / "logs"


def build(con: duckdb.DuckDBPyConnection, logs: Path, config: str | None) -> None:
    pattern = str(logs / "run-*.jsonl").replace("\\", "/")
    con.execute(
        f"""
        create or replace view ev_all as
        select * from read_json('{pattern}', format = 'newline_delimited',
                                union_by_name = true, maximum_object_size = 16777216,
                                ignore_errors = true)
        """
    )
    # only runs that finished writing (have a run_end); optionally one config
    cfg_filter = f"and s.config_hash = '{config}'" if config else ""
    con.execute(
        f"""
        create or replace table runs as
        select s.run_id, s.config_hash, s.build, s.seed,
               try_cast(s.started_at as timestamp) as started_at,
               e.reason, e.score, e.wave, e.accuracy, e.wpm, e.longest_streak,
               cast(e.correct as bigint) as correct, cast(e.errors as bigint) as errors,
               e.airstrikes_left, e.t / 1000.0 as seconds
        from ev_all s join ev_all e on s.run_id = e.run_id
        where s.type = 'run_start' and e.type = 'run_end' {cfg_filter}
        """
    )
    con.execute("create or replace view ev as select * from ev_all where run_id in (select run_id from runs)")
    # spawn pacing changed from a fixed interval to letters per second; keep
    # whichever columns the loaded logs have
    have = {r[0] for r in con.execute("describe ev").fetchall()}
    spawn_cols = "".join(f"ws.{c}, " for c in ("spawn_interval", "spawn_lps") if c in have)
    con.execute(
        f"""
        create or replace table waves as
        select ws.run_id, ws.wave, {spawn_cols} ws.speed_factor,
               ws.composition.mine as mines, ws.composition.destroyer as destroyers,
               ws.composition.oppressor as oppressors,
               we.duration / 1000.0 as seconds, we.accuracy, we.misses, we.peak_enemies,
               we.closest_approach, we.airstrikes_left, we.run_id is not null as cleared
        from ev ws
        left join ev we on we.run_id = ws.run_id and we.wave = ws.wave and we.type = 'wave_end'
        where ws.type = 'wave_start'
        """
    )
    con.execute(
        """
        create or replace table enemies as
        select s.run_id, s.wave, s.id, s.kind, s.word, length(s.word) as letters, s.t as spawned_t,
               s.x, s.y, s.speed,
               k.cause as killed_by, k.ms_alive, k.misses, k.distance as distance_at_death
        from ev s
        left join ev k on k.run_id = s.run_id and k.id = s.id and k.type = 'kill'
        where s.type = 'spawn'
        """
    )
    con.execute(
        """
        create or replace table keystrokes as
        select k.run_id, k.t, k.wave, k.char, k.expected, cast(k.correct as boolean) as correct, k.id as enemy_id,
               k.ms_since_prev, k.multiplier, e.word, e.kind
        from ev k left join enemies e on e.run_id = k.run_id and e.id = k.id
        where k.type = 'key'
        """
    )


def show(con: duckdb.DuckDBPyConnection, title: str, sql: str, note: str = "") -> None:
    print(f"\n== {title}")
    if note:
        print(note)
    rel = con.sql(sql)
    rel.show(max_rows=40, max_width=160)


def report(con: duckdb.DuckDBPyConnection) -> None:
    n = con.sql("select count(*) from runs").fetchall()[0][0]
    if n == 0:
        print("No finished runs found.")
        return
    show(
        con,
        "Runs by config",
        """
        select config_hash, count(*) as runs, round(median(wave), 1) as median_wave,
               round(median(score)) as median_score, round(avg(accuracy) * 100, 1) as accuracy_pct,
               round(avg(wpm), 1) as wpm, min(started_at) as first_run, max(started_at) as last_run
        from runs group by all order by last_run desc
        """,
        "Compare a tuning change by its config hash against the runs before it.",
    )

    # 1. Difficulty curve
    show(
        con,
        "Difficulty: where runs end, and how close enemies get",
        """
        with reached as (
            select w.wave, count(distinct w.run_id) as runs_reaching
            from waves w group by all
        ), died as (
            select wave, count(*) as runs_ending_here from runs where reason = 'death' group by all
        ), close as (
            select wave, round(avg(closest_approach), 1) as avg_closest_px,
                   round(min(closest_approach), 1) as min_closest_px
            from waves where cleared group by all
        )
        select r.wave, r.runs_reaching,
               round(100.0 * r.runs_reaching / (select count(*) from runs), 1) as pct_of_runs,
               coalesce(d.runs_ending_here, 0) as runs_ending_here,
               c.avg_closest_px, c.min_closest_px
        from reached r left join died d using (wave) left join close c using (wave)
        order by r.wave
        """,
        "closest_px = smallest gap between any enemy and the squad's hitbox in a cleared wave.",
    )

    # 2. Pacing
    show(
        con,
        "Pacing: typing speed a wave demands vs the player's",
        """
        with squad as (
            select run_id,
                   tunables.player.x::double as px,
                   (tunables.world.height - tunables.player.yFromBottom)::double as py,
                   (tunables.player.hitbox.h / 2)::double as reach
            from ev where type = 'run_start'
        ), ws as (
            select run_id, wave, t as wave_t from ev where type = 'wave_start'
        ), deadlines as (
            -- when each enemy would reach the squad if nobody typed its word
            select e.run_id, e.wave, e.letters,
                   (e.spawned_t - ws.wave_t) / 1000.0
                     + greatest(sqrt((q.px - e.x) ** 2 + (q.py - e.y) ** 2) - q.reach, 1) / e.speed as deadline
            from enemies e join ws using (run_id, wave) join squad q using (run_id)
        ), need as (
            -- slowest steady typing speed that kills every enemy before its deadline
            select run_id, wave,
                   max(cum_letters / deadline) as required_lps
            from (select *, sum(letters) over (partition by run_id, wave order by deadline
                                               rows between unbounded preceding and current row) as cum_letters
                  from deadlines)
            group by all
        ), cap as (
            -- the player's own pace while typing (median gap between correct keystrokes)
            select run_id, 1000.0 / median(ms_since_prev) as player_lps
            from keystrokes where correct and ms_since_prev > 0 group by all
        )
        select n.wave,
               round(avg(n.required_lps), 2) as required_lps,
               round(avg(c.player_lps), 2) as player_lps,
               round(median(n.required_lps / c.player_lps), 2) as demand_ratio,
               count(*) as runs
        from need n join cap c using (run_id)
        group by all order by n.wave
        """,
        "required_lps = slowest steady typing that stops every enemy before it reaches the squad "
        "(ignores knockback, so it is a little pessimistic). player_lps = the player's own typing pace. "
        "demand_ratio well below 1 = slack; approaching 1 = pressure; a jump between waves = a difficulty wall.",
    )

    # 3. Fairness
    show(
        con,
        "Fairness: what kills the squad",
        """
        select d.killer_kind, length(d.killer_word) as word_length, count(*) as deaths,
               round(avg(d.letters_left), 1) as avg_letters_left,
               round(100.0 * avg((r.airstrikes_left > 0)::int), 1) as pct_with_airstrikes_unused
        from ev d join runs r using (run_id)
        where d.type = 'death'
        group by all order by deaths desc
        """,
    )
    have = {r[0] for r in con.execute("describe ev").fetchall()}
    requeued = (
        "coalesce(sum(e.requeued) filter (where e.type = 'airstrike'), 0) as sent_back,"
        if "requeued" in have
        else ""
    )
    last_cost = (
        "max(e.cost) filter (where e.type = 'airstrike_earned') as last_cost,"
        if "cost" in have
        else ""
    )
    spared = (
        "coalesce(sum(e.spared) filter (where e.type = 'airstrike'), 0) as survived_strikes,"
        if "spared" in have
        else ""
    )
    show(
        con,
        "Fairness: airstrikes used and earned back",
        f"""
        select r.run_id, r.wave, r.reason,
               count(*) filter (where e.type = 'airstrike') as used,
               count(*) filter (where e.type = 'airstrike_earned') as earned,
               {requeued}
               {spared}
               {last_cost}
               r.airstrikes_left as left_at_end
        from runs r left join ev e using (run_id)
        group by all order by r.run_id
        """,
        "earned = refilled by typing words (counts only while below the maximum). "
        "sent_back = enemies added back when a strike reset the wave to its full count "
        "(runs before the reset show none, or count only what each strike destroyed). "
        "last_cost = words the last airstrike earned back cost (it climbs each time). "
        "survived_strikes = enemies the blast reached that rode it out (far from the squad only).",
    )
    show(
        con,
        "Fairness: stuck on a lock",
        """
        select r.run_id, r.wave,
               count(*) filter (where e.type = 'switch_hint') as switch_hints,
               count(*) filter (where e.type = 'release') as backspace_releases,
               count(*) filter (where e.type = 'jammed') as keys_dropped_jammed
        from runs r left join ev e using (run_id)
        group by all order by r.run_id
        """,
        "switch_hints = times the 'Backspace: switch target' tag appeared after wrong letters in a row on a lock "
        "(runs before the hint show none). A release = Backspace dropping a lock. "
        "keys_dropped_jammed = letters typed while the rifles were jammed by a wrong letter (mashing).",
    )
    show(
        con,
        "Fairness: first-letter clashes when locking",
        """
        select wave, count(*) as locks,
               round(100.0 * avg((candidates > 1)::int), 1) as pct_with_a_clash,
               round(avg(distance), 0) as avg_lock_distance_px
        from ev where type = 'lock' group by all order by wave
        """,
        "A clash = more than one enemy's word started with the letter typed.",
    )

    # 4. Word quality
    show(
        con,
        "Word quality: letters missed most (per letter that should have been typed)",
        """
        with m as (
            select expected as letter, count(*) as misses from keystrokes where not correct and expected is not null group by all
        ), c as (
            select char as letter, count(*) as typed, median(ms_since_prev) as median_ms
            from keystrokes where correct group by all
        )
        select c.letter, c.typed, coalesce(m.misses, 0) as misses,
               round(100.0 * coalesce(m.misses, 0) / (c.typed + coalesce(m.misses, 0)), 1) as miss_pct,
               c.median_ms
        from c left join m using (letter)
        order by miss_pct desc, median_ms desc limit 12
        """,
        "median_ms = typical time from the previous keystroke to a correct one.",
    )
    show(
        con,
        "Word quality: hardest words (typed at least twice)",
        """
        select word, count(*) as times, round(avg(misses), 2) as avg_misses,
               round(avg(ms_alive) / 1000.0, 1) as avg_seconds_alive
        from enemies where killed_by = 'typed' and letters > 1
        group by all having count(*) >= 2
        order by avg_misses desc, avg_seconds_alive desc limit 12
        """,
    )

    # 5. Engagement
    show(
        con,
        "Engagement",
        """
        with ordered as (
            select *, lag(started_at) over (order by started_at) as prev_start,
                      lag(seconds) over (order by started_at) as prev_seconds
            from runs
        )
        select count(*) as runs,
               round(median(seconds) / 60, 1) as median_run_minutes,
               round(median(epoch(started_at - prev_start) - prev_seconds) / 60, 1) as median_minutes_between_runs,
               count(*) filter (where reason = 'quit') as quit_mid_run,
               list(wave order by started_at) filter (where reason = 'quit') as quit_at_waves
        from ordered
        """,
        "Minutes between runs counts from the end of one run's active play to the next start (pauses inflate it).",
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("logs", nargs="?", type=Path, help="folder of run-*.jsonl files (default: %%APPDATA%%/Wordfront/logs)")
    ap.add_argument("--config", help="only runs with this config hash")
    ap.add_argument("--save", type=Path, help="also save the tables to this DuckDB file")
    args = ap.parse_args()

    logs = args.logs or default_logs()
    if (logs / "logs").is_dir():
        logs = logs / "logs"
    if not any(logs.glob("run-*.jsonl")):
        sys.exit(f"No run logs in {logs}")

    con = duckdb.connect(str(args.save) if args.save else ":memory:")
    build(con, logs, args.config)
    report(con)


if __name__ == "__main__":
    main()
