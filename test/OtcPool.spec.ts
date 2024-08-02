import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseUnits } from "viem";
import hre from "hardhat";
import accountsFixture from "./fixtures/accountsFixture";
import { zeroAddress } from "./utils/constants";

describe("OtcPool tests", function () {
  async function fixture() {
    const af = await accountsFixture();
    const OtcPool = await hre.viem.deployContract("OtcPool");

    return { ...af, OtcPool };
  }

  describe("createPool", function () {
    it("should create a pool successfully", async function () {
      const { OtcPool, usdc, weth, alice } = await loadFixture(fixture);
      const saleAmount = parseUnits("1000", 6); // USDC has 6 decimals
      const thresholdAmount = parseUnits("1", 18); // WETH has 18 decimals
      const duration = 86400; // 1 day
      const minFillAmount = parseUnits("0.1", 18);
      const maxFillAmount = parseUnits("1", 18);

      await usdc.write.approve([OtcPool.address, saleAmount], {
        account: alice.account,
      });

      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          saleAmount,
          thresholdAmount,
          BigInt(duration),
          minFillAmount,
          maxFillAmount,
        ],
        { account: alice.account }
      );

      const poolId = 1n; // first pool should have ID 1
      const pool = await OtcPool.read.pools([poolId]);

      expect(pool.tokenA.toLowerCase()).to.equal(usdc.address.toLowerCase());
      expect(pool.tokenB.toLowerCase()).to.equal(weth.address.toLowerCase());
      expect(pool.saleAmount).to.equal(saleAmount);
      expect(pool.thresholdAmount).to.equal(thresholdAmount);
      expect(pool.minFillAmount).to.equal(minFillAmount);
      expect(pool.maxFillAmount).to.equal(maxFillAmount);
      expect(pool.isActive).to.be.false;
      expect(pool.isCancelled).to.be.false;
    });

    it("should revert with invalid parameters", async function () {
      const { OtcPool, usdc, weth, alice } = await loadFixture(fixture);

      await expect(
        OtcPool.write.createPool(
          [
            zeroAddress,
            weth.address,
            parseUnits("1000", 6),
            parseUnits("1", 18),
            86400n,
            parseUnits("0.1", 18),
            parseUnits("1", 18),
          ],
          { account: alice.account }
        )
      ).to.be.rejectedWith("InvalidTokenAddresses");

      await expect(
        OtcPool.write.createPool(
          [
            usdc.address,
            weth.address,
            0n,
            parseUnits("1", 18),
            86400n,
            parseUnits("0.1", 18),
            parseUnits("1", 18),
          ],
          { account: alice.account }
        )
      ).to.be.rejectedWith("InvalidAmounts");

      await expect(
        OtcPool.write.createPool(
          [
            usdc.address,
            weth.address,
            parseUnits("1000", 6),
            parseUnits("1", 18),
            0n,
            parseUnits("0.1", 18),
            parseUnits("1", 18),
          ],
          { account: alice.account }
        )
      ).to.be.rejectedWith("InvalidDuration");

      await expect(
        OtcPool.write.createPool(
          [
            usdc.address,
            weth.address,
            parseUnits("1000", 6),
            parseUnits("1", 18),
            86400n,
            parseUnits("1", 18),
            parseUnits("0.1", 18),
          ],
          { account: alice.account }
        )
      ).to.be.rejectedWith("InvalidFillAmounts");
    });
  });

  describe("invest", function () {
    it("should allow investment within limits", async function () {
      const { OtcPool, usdc, weth, alice, bob } = await loadFixture(fixture);

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("0.5", 18),
        ],
        { account: alice.account }
      );

      // invest
      await weth.write.approve([OtcPool.address, parseUnits("0.5", 18)], {
        account: bob.account,
      });
      await OtcPool.write.invest([1n, parseUnits("0.5", 18)], {
        account: bob.account,
      });

      const investment = await OtcPool.read.investments([1n]);
      expect(investment.poolId).to.equal(1n);
      expect(investment.amount).to.equal(parseUnits("0.5", 18));
    });

    it("should revert when investing below minimum", async function () {
      const { OtcPool, usdc, weth, alice, bob } = await loadFixture(fixture);

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("0.5", 18),
        ],
        { account: alice.account }
      );

      // try to invest below minimum
      await weth.write.approve([OtcPool.address, parseUnits("0.05", 18)], {
        account: bob.account,
      });
      await expect(
        OtcPool.write.invest([1n, parseUnits("0.05", 18)], {
          account: bob.account,
        })
      ).to.be.rejectedWith("AmountBelowMinimumFill");
    });

    it("should revert when investing above maximum", async function () {
      const { OtcPool, usdc, weth, alice, bob } = await loadFixture(fixture);

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("0.5", 18),
        ],
        { account: alice.account }
      );

      // try to invest above maximum
      await weth.write.approve([OtcPool.address, parseUnits("0.6", 18)], {
        account: bob.account,
      });
      await expect(
        OtcPool.write.invest([1n, parseUnits("0.6", 18)], {
          account: bob.account,
        })
      ).to.be.rejectedWith("AmountAboveMaximumFill");
    });

    it("should revert when investing after deadline", async function () {
      const { OtcPool, usdc, weth, alice, bob } = await loadFixture(fixture);

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("0.5", 18),
        ],
        { account: alice.account }
      );

      // advance time past deadline
      await time.increase(86401);

      // try to invest after deadline
      await weth.write.approve([OtcPool.address, parseUnits("0.5", 18)], {
        account: bob.account,
      });
      await expect(
        OtcPool.write.invest([1n, parseUnits("0.5", 18)], {
          account: bob.account,
        })
      ).to.be.rejectedWith("PoolDeadlinePassed");
    });
  });

  describe("activateSale", function () {
    it("should activate sale when threshold is met", async function () {
      const { OtcPool, usdc, weth, alice, bob, charlie } = await loadFixture(
        fixture
      );

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("0.5", 18),
        ],
        { account: alice.account }
      );

      // invest to meet threshold
      await weth.write.approve([OtcPool.address, parseUnits("0.5", 18)], {
        account: bob.account,
      });
      await OtcPool.write.invest([1n, parseUnits("0.5", 18)], {
        account: bob.account,
      });
      await weth.write.approve([OtcPool.address, parseUnits("0.5", 18)], {
        account: charlie.account,
      });
      await OtcPool.write.invest([1n, parseUnits("0.5", 18)], {
        account: charlie.account,
      });

      // activate sale
      await OtcPool.write.activateSale([1n], { account: alice.account });

      const pool = await OtcPool.read.pools([1n]);
      expect(pool.isActive).to.be.true;
    });

    it("should revert when activating before threshold is met", async function () {
      const { OtcPool, usdc, weth, alice, bob } = await loadFixture(fixture);

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("0.5", 18),
        ],
        { account: alice.account }
      );

      // invest below threshold
      await weth.write.approve([OtcPool.address, parseUnits("0.5", 18)], {
        account: bob.account,
      });
      await OtcPool.write.invest([1n, parseUnits("0.5", 18)], {
        account: bob.account,
      });

      // try to activate sale
      await expect(
        OtcPool.write.activateSale([1n], { account: alice.account })
      ).to.be.rejectedWith("ThresholdNotReached");
    });

    it("should revert when activating after deadline", async function () {
      const { OtcPool, usdc, weth, alice, bob, charlie } = await loadFixture(
        fixture
      );

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("0.5", 18),
        ],
        { account: alice.account }
      );

      // invest to meet threshold
      await weth.write.approve([OtcPool.address, parseUnits("0.5", 18)], {
        account: bob.account,
      });
      await OtcPool.write.invest([1n, parseUnits("0.5", 18)], {
        account: bob.account,
      });
      await weth.write.approve([OtcPool.address, parseUnits("0.5", 18)], {
        account: charlie.account,
      });
      await OtcPool.write.invest([1n, parseUnits("0.5", 18)], {
        account: charlie.account,
      });

      // advance time past deadline
      await time.increase(86401);

      // try to activate sale
      await expect(
        OtcPool.write.activateSale([1n], { account: alice.account })
      ).to.be.rejectedWith("PoolDeadlinePassed");
    });
  });

  describe("cancelSale", function () {
    it("should cancel sale successfully", async function () {
      const { OtcPool, usdc, weth, alice } = await loadFixture(fixture);

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("0.5", 18),
        ],
        { account: alice.account }
      );

      // cancel sale
      await OtcPool.write.cancelSale([1n], { account: alice.account });

      const pool = await OtcPool.read.pools([1n]);
      expect(pool.isCancelled).to.be.true;
    });

    it("should revert when cancelling an active sale", async function () {
      const { OtcPool, usdc, weth, alice, bob, charlie } = await loadFixture(
        fixture
      );

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("0.5", 18),
        ],
        { account: alice.account }
      );

      // invest to meet threshold
      await weth.write.approve([OtcPool.address, parseUnits("0.5", 18)], {
        account: bob.account,
      });
      await OtcPool.write.invest([1n, parseUnits("0.5", 18)], {
        account: bob.account,
      });
      await weth.write.approve([OtcPool.address, parseUnits("0.5", 18)], {
        account: charlie.account,
      });
      await OtcPool.write.invest([1n, parseUnits("0.5", 18)], {
        account: charlie.account,
      });

      // activate sale
      await OtcPool.write.activateSale([1n], { account: alice.account });

      // try to cancel active sale
      await expect(
        OtcPool.write.cancelSale([1n], { account: alice.account })
      ).to.be.rejectedWith("PoolUnavailableForCancellation");
    });
  });

  describe("claimTokens", function () {
    it("should allow claiming tokens after sale activation", async function () {
      const { OtcPool, usdc, weth, alice, bob } = await loadFixture(fixture);

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("1", 18),
        ],
        { account: alice.account }
      );

      // invest
      await weth.write.approve([OtcPool.address, parseUnits("1", 18)], {
        account: bob.account,
      });
      await OtcPool.write.invest([1n, parseUnits("1", 18)], {
        account: bob.account,
      });

      // activate sale
      await OtcPool.write.activateSale([1n], { account: alice.account });

      // claim tokens
      const balanceBefore = await usdc.read.balanceOf([bob.account.address]);
      await OtcPool.write.claimTokens([1n], { account: bob.account });
      const balanceAfter = await usdc.read.balanceOf([bob.account.address]);
      expect(balanceAfter - balanceBefore).to.equal(parseUnits("1000", 6));
    });

    it("should revert when claiming tokens before sale activation", async function () {
      const { OtcPool, usdc, weth, alice, bob } = await loadFixture(fixture);

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("1", 18),
        ],
        { account: alice.account }
      );

      // invest
      await weth.write.approve([OtcPool.address, parseUnits("1", 18)], {
        account: bob.account,
      });
      await OtcPool.write.invest([1n, parseUnits("1", 18)], {
        account: bob.account,
      });

      // try to claim tokens before activation
      await expect(
        OtcPool.write.claimTokens([1n], { account: bob.account })
      ).to.be.rejectedWith("SaleNotActivated");
    });
  });

  describe("claimInvestment", function () {
    it("should allow claiming investment after cancellation", async function () {
      const { OtcPool, usdc, weth, alice, bob } = await loadFixture(fixture);

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("1", 18),
        ],
        { account: alice.account }
      );

      // invest
      await weth.write.approve([OtcPool.address, parseUnits("0.5", 18)], {
        account: bob.account,
      });
      await OtcPool.write.invest([1n, parseUnits("0.5", 18)], {
        account: bob.account,
      });

      // cancel sale
      await OtcPool.write.cancelSale([1n], { account: alice.account });

      // claim investment
      const balanceBefore = await weth.read.balanceOf([bob.account.address]);
      await OtcPool.write.claimInvestment([1n], { account: bob.account });
      const balanceAfter = await weth.read.balanceOf([bob.account.address]);
      expect(balanceAfter - balanceBefore).to.equal(parseUnits("0.5", 18));
    });

    it("should allow claiming investment after deadline", async function () {
      const { OtcPool, usdc, weth, alice, bob } = await loadFixture(fixture);

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("1", 18),
        ],
        { account: alice.account }
      );

      // invest
      await weth.write.approve([OtcPool.address, parseUnits("0.5", 18)], {
        account: bob.account,
      });
      await OtcPool.write.invest([1n, parseUnits("0.5", 18)], {
        account: bob.account,
      });

      // advance time past deadline
      await time.increase(86401);

      // claim investment
      const balanceBefore = await weth.read.balanceOf([bob.account.address]);
      await OtcPool.write.claimInvestment([1n], { account: bob.account });
      const balanceAfter = await weth.read.balanceOf([bob.account.address]);
      expect(balanceAfter - balanceBefore).to.equal(parseUnits("0.5", 18));
    });

    it("should revert when claiming investment for active sale", async function () {
      const { OtcPool, usdc, weth, alice, bob } = await loadFixture(fixture);

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("1", 18),
        ],
        { account: alice.account }
      );

      // invest
      await weth.write.approve([OtcPool.address, parseUnits("1", 18)], {
        account: bob.account,
      });
      await OtcPool.write.invest([1n, parseUnits("1", 18)], {
        account: bob.account,
      });

      // activate sale
      await OtcPool.write.activateSale([1n], { account: alice.account });

      // try to claim investment
      await expect(
        OtcPool.write.claimInvestment([1n], { account: bob.account })
      ).to.be.rejectedWith("SaleIsActive");
    });

    it("should revert when claiming investment before deadline and not cancelled", async function () {
      const { OtcPool, usdc, weth, alice, bob } = await loadFixture(fixture);

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("1", 18),
        ],
        { account: alice.account }
      );

      // invest
      await weth.write.approve([OtcPool.address, parseUnits("0.5", 18)], {
        account: bob.account,
      });
      await OtcPool.write.invest([1n, parseUnits("0.5", 18)], {
        account: bob.account,
      });

      // try to claim investment
      await expect(
        OtcPool.write.claimInvestment([1n], { account: bob.account })
      ).to.be.rejectedWith("CannotClaimYet");
    });
  });

  describe("Edge cases", function () {
    it("should not allow investing more than remaining amount", async function () {
      const { OtcPool, usdc, weth, alice, bob, charlie } = await loadFixture(
        fixture
      );

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("1", 18),
        ],
        { account: alice.account }
      );

      // bob invests 0.6 WETH
      await weth.write.approve([OtcPool.address, parseUnits("0.6", 18)], {
        account: bob.account,
      });
      await OtcPool.write.invest([1n, parseUnits("0.6", 18)], {
        account: bob.account,
      });

      // charlie tries to invest 0.5 WETH, but only 0.4 WETH should be accepted
      await weth.write.approve([OtcPool.address, parseUnits("0.5", 18)], {
        account: charlie.account,
      });
      await OtcPool.write.invest([1n, parseUnits("0.5", 18)], {
        account: charlie.account,
      });

      const charlieInvestment = await OtcPool.read.investments([2n]);
      expect(charlieInvestment.amount).to.equal(parseUnits("0.4", 18));

      const pool = await OtcPool.read.pools([1n]);
      expect(pool.totalInvested).to.equal(parseUnits("1", 18));
    });

    it("should not allow creating a pool with invalid token addresses", async function () {
      const { OtcPool, alice } = await loadFixture(fixture);

      await expect(
        OtcPool.write.createPool(
          [
            zeroAddress,
            zeroAddress,
            parseUnits("1000", 6),
            parseUnits("1", 18),
            86400n,
            parseUnits("0.1", 18),
            parseUnits("1", 18),
          ],
          { account: alice.account }
        )
      ).to.be.rejectedWith("InvalidTokenAddresses");
    });

    it("should not allow claiming tokens twice", async function () {
      const { OtcPool, usdc, weth, alice, bob } = await loadFixture(fixture);

      // create pool
      await usdc.write.approve([OtcPool.address, parseUnits("1000", 6)], {
        account: alice.account,
      });
      await OtcPool.write.createPool(
        [
          usdc.address,
          weth.address,
          parseUnits("1000", 6),
          parseUnits("1", 18),
          86400n,
          parseUnits("0.1", 18),
          parseUnits("1", 18),
        ],
        { account: alice.account }
      );

      // invest
      await weth.write.approve([OtcPool.address, parseUnits("1", 18)], {
        account: bob.account,
      });
      await OtcPool.write.invest([1n, parseUnits("1", 18)], {
        account: bob.account,
      });

      // activate sale
      await OtcPool.write.activateSale([1n], { account: alice.account });

      // claim tokens
      await OtcPool.write.claimTokens([1n], { account: bob.account });

      // try to claim tokens again
      await expect(
        OtcPool.write.claimTokens([1n], { account: bob.account })
      ).to.be.rejectedWith("ERC721: invalid token ID");
    });
  });
});
