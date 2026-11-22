#!/usr/bin/env python3
"""Set or reset the admin password from the command line (recovery path)."""
import sys

from auth import password_error, set_password


def main():
    password = input("Enter admin password: ").strip()
    err = password_error(password)
    if err:
        print(err)
        sys.exit(1)

    set_password(password)
    print("Password saved.")
    print("\nStart with:  python3 run.py")


if __name__ == "__main__":
    main()
