import { sql } from "~/db/sql";
import type {
  Build,
  BuildAbility,
  BuildWeapon,
  GearType,
  UserWithPlusTier,
} from "~/db/types";
import { type ModeShort, weaponIdToAltId } from "~/modules/in-game-lists";
import { modesShort } from "~/modules/in-game-lists";
import invariant from "tiny-invariant";
import type {
  BuildAbilitiesTuple,
  MainWeaponId,
} from "~/modules/in-game-lists/types";

import createBuildSql from "./createBuild.sql";
import createBuildWeaponSql from "./createBuildWeapon.sql";
import createBuildAbilitySql from "./createBuildAbility.sql";
import countByUserIdSql from "./countByUserId.sql";
import buildsByUserIdSql from "./buildsByUserId.sql";
import buildsByWeaponIdSql from "./buildsByWeaponId.sql";
import deleteByIdSql from "./deleteById.sql";

const createBuildStm = sql.prepare(createBuildSql);
const createBuildWeaponStm = sql.prepare(createBuildWeaponSql);
const createBuildAbilityStm = sql.prepare(createBuildAbilitySql);
const countByUserIdStm = sql.prepare(countByUserIdSql);
const buildsByUserIdStm = sql.prepare(buildsByUserIdSql);
const buildsByWeaponIdStm = sql.prepare(buildsByWeaponIdSql);
const deleteByIdStm = sql.prepare(deleteByIdSql);

interface CreateArgs {
  ownerId: Build["ownerId"];
  title: Build["title"];
  description: Build["description"];
  modes: Array<ModeShort> | null;
  headGearSplId: Build["headGearSplId"];
  clothesGearSplId: Build["clothesGearSplId"];
  shoesGearSplId: Build["shoesGearSplId"];
  weaponSplIds: Array<BuildWeapon["weaponSplId"]>;
  abilities: BuildAbilitiesTuple;
  private: Build["private"];
}
export const create = sql.transaction((build: CreateArgs) => {
  const createdBuild = createBuildStm.get({
    ownerId: build.ownerId,
    title: build.title,
    description: build.description,
    modes:
      build.modes && build.modes.length > 0
        ? JSON.stringify(
            build.modes
              .slice()
              .sort((a, b) => modesShort.indexOf(a) - modesShort.indexOf(b))
          )
        : null,
    headGearSplId: build.headGearSplId,
    clothesGearSplId: build.clothesGearSplId,
    shoesGearSplId: build.shoesGearSplId,
    private: build.private,
  }) as Build;

  for (const weaponSplId of build.weaponSplIds) {
    createBuildWeaponStm.run({
      buildId: createdBuild.id,
      weaponSplId,
    });
  }

  for (const [rowI, row] of build.abilities.entries()) {
    const gearType: GearType =
      rowI === 0 ? "HEAD" : rowI === 1 ? "CLOTHES" : "SHOES";

    for (const [abilityI, ability] of row.entries()) {
      createBuildAbilityStm.run({
        buildId: createdBuild.id,
        gearType,
        ability,
        slotIndex: abilityI,
      });
    }
  }
});

export const updateByReplacing = sql.transaction(
  (build: CreateArgs & { id: Build["id"] }) => {
    deleteByIdStm.run({ id: build.id });
    create(build);
  }
);

export function countByUserId({
  userId,
  loggedInUserId,
}: {
  userId: Build["ownerId"];
  loggedInUserId?: UserWithPlusTier["id"];
}) {
  return (countByUserIdStm.get({ userId, loggedInUserId })?.count ??
    0) as number;
}

export interface BuildWeaponWithTop500Info {
  weaponSplId: MainWeaponId;
  minRank: number | null;
  maxPower: number | null;
}

type BuildsByUserRow = Pick<
  Build,
  | "id"
  | "title"
  | "description"
  | "modes"
  | "headGearSplId"
  | "clothesGearSplId"
  | "shoesGearSplId"
  | "updatedAt"
  | "private"
> & {
  weapons: string;
  abilities: string;
};
export function buildsByUserId({
  userId,
  loggedInUserId,
}: {
  userId: Build["ownerId"];
  loggedInUserId?: UserWithPlusTier["id"];
}) {
  const rows = buildsByUserIdStm.all({
    userId,
    loggedInUserId,
  }) as Array<BuildsByUserRow>;

  return rows.map(augmentBuild);
}

type BuildsByWeaponIdRow = BuildsByUserRow &
  Pick<
    UserWithPlusTier,
    "discordId" | "discordName" | "discordDiscriminator" | "plusTier"
  >;

export function buildsByWeaponId({
  weaponId,
  limit,
}: {
  weaponId: BuildWeapon["weaponSplId"];
  limit: number;
}) {
  const rows = buildsByWeaponIdStm.all({
    weaponId,
    // default to impossible weapon id so we can always have same amount of placeholder values
    altWeaponId: weaponIdToAltId.get(weaponId) ?? -1,
    limit,
  }) as Array<BuildsByWeaponIdRow>;

  return rows.map(augmentBuild);
}

function augmentBuild<T>({
  weapons: rawWeapons,
  modes: rawModes,
  abilities: rawAbilities,
  ...row
}: T & { modes: Build["modes"]; weapons: string; abilities: string }) {
  const modes = rawModes ? (JSON.parse(rawModes) as ModeShort[]) : null;
  const weapons = (
    JSON.parse(rawWeapons) as Array<BuildWeaponWithTop500Info>
  ).sort((a, b) => a.weaponSplId - b.weaponSplId);
  const abilities = JSON.parse(rawAbilities) as Array<
    Pick<BuildAbility, "ability" | "gearType" | "slotIndex">
  >;

  return {
    ...row,
    modes,
    weapons,
    abilities: dbAbilitiesToArrayOfArrays(abilities),
  };
}

const gearOrder: Array<BuildAbility["gearType"]> = ["HEAD", "CLOTHES", "SHOES"];
function dbAbilitiesToArrayOfArrays(
  abilities: Array<Pick<BuildAbility, "ability" | "gearType" | "slotIndex">>
): BuildAbilitiesTuple {
  const sorted = abilities
    .slice()
    .sort((a, b) => {
      if (a.gearType === b.gearType) return a.slotIndex - b.slotIndex;

      return gearOrder.indexOf(a.gearType) - gearOrder.indexOf(b.gearType);
    })
    .map((a) => a.ability);

  invariant(sorted.length === 12, "expected 12 abilities");

  return [
    [sorted[0]!, sorted[1]!, sorted[2]!, sorted[3]!],
    [sorted[4]!, sorted[5]!, sorted[6]!, sorted[7]!],
    [sorted[8]!, sorted[9]!, sorted[10]!, sorted[11]!],
  ];
}

export function deleteById(id: Build["id"]) {
  deleteByIdStm.run({ id });
}
