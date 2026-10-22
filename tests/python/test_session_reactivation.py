import unittest
from sector.runtime.reset_host_runner import clean_shutdown_verified


class SessionReactivationTests(unittest.TestCase):
    def test_only_a_fully_verified_native_stop_produces_a_receipt(self):
        self.assertTrue(clean_shutdown_verified(None, None, 3, 0, {"outer": True, "scoring": True}))
        for values in [
            ("failure", None, 3, 0, {"hook": True}),
            (None, 0, 3, 0, {"hook": True}),
            (None, None, 5, 0, {"hook": True}),
            (None, None, 3, 1, {"hook": True}),
            (None, None, 3, 0, {}),
            (None, None, 3, 0, {"hook": False}),
            (None, None, 3, 0, {"hook": None}),
        ]:
            self.assertFalse(clean_shutdown_verified(*values), values)


if __name__ == "__main__":
    unittest.main()
