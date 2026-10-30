from src.score import bucket_for, grade_for

CFG = {"grading": {"A": 70, "B": 55}}


def test_grade_thresholds():
    assert grade_for("breakout", 72, CFG) == "A"
    assert grade_for("pullback", 60, CFG) == "B"
    assert grade_for("squeeze", 40, CFG) == "C"


def test_shock_is_watch_only():
    assert grade_for("shock", 99, CFG) == "W"


def test_bucket_priority():
    assert bucket_for(True, True, "A") == "filtered"
    assert bucket_for(False, True, "A") == "wait"
    assert bucket_for(False, False, "B") == "actionable"
    assert bucket_for(False, False, "C") == "watch"
    assert bucket_for(False, False, "W") == "watch"
