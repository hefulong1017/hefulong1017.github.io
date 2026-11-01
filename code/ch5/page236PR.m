tic
for ii=1:4
m1=10*2^(ii-1);
m2=10*2^(ii-1);
n=10*2^(ii-1);
xa = 0; xb = 1; ya = 0; yb = 1; ta = 0; tb = 1;
h1 = (xb-xa)/m1;h2=(yb-ya)/m2;dt = (tb-ta)/n;
x = xa:h1:xb;  x = x'; y = ya:h2:yb;  y = y';
t = ta:dt:tb; t = t';
a=1;
r1 = a*dt/h1^2;
r2 = a*dt/h2^2;
u = zeros(m1+1,m2+1,n+1);
for i = 1:m1+1
    for j = 1:m2+1
        u(i,j,1) = exp(1/2*(x(i)+y(j)));
    end
end
for j = 1:m2+1
    for k = 1:n+1
        u(1,j,k) = exp(1/2*y(j)-t(k));
        u(m2+1,j,k) = exp(1/2*(1+y(j))-t(k));
    end
end
for i = 1:m1+1
    for k = 1:n+1
        u(i,1,k) = exp(1/2*x(i)-t(k));
        u(i,m2+1,k) = exp(1/2*(1+x(i))-t(k));
    end
end
ff5 = @(x,y,t) -3/2*exp(1/2*(x+y)-t);

for k = 1:n
    u1 = zeros(m1+1,m2+1);  
    for j = 2:m2
        u1(1,j)   = (1-r2)/2*u(1,j,k)+(1+r2)/2*u(1,j,k+1)+r2/4*(u(1,j-1,k)+u(1,j+1,k)-u(1,j-1,k+1)-u(1,j+1,k+1));
        u1(m1+1,j) = (1-r2)/2*u(m1+1,j,k)+(1+r2)/2*u(m1+1,j,k+1)+r2/4*(u(m1+1,j-1,k)+u(m1+1,j+1,k)-u(m1+1,j-1,k+1)-u(m1+1,j+1,k+1));
        H = zeros(m1-1,1);
        H(1,1)   = 1/2*r1*u1(1,j);
        H(m1-1,1) = 1/2*r1*u1(m1+1,j);
       row1 = zeros(m2-1, 1);
      row1(2, 1) = -1/2*r1;row1(1, 1) = 1+r1; 
      A = toeplitz(row1);
        u1(2:m1,j) = chase(A,((1-r2)*u(2:m1,j,k)+1/2*r2*u(2:m1,j+1,k)+1/2*r2*u(2:m1,j-1,k)+dt/2*(ff5(x(2:m1),y(j),t(k))+ff5(x(2:m1),y(j),t(k+1)))/2+H));
    end
    for i = 2:m1
        u(i,1,k+1) = exp(1/2*x(i)-t(k+1));
        u(i,m2+1,k+1) = exp(1/2*(1+x(i))-t(k+1));
        H1 = zeros(m2-1,1);
        H1(1,1)   = 1/2*r2*u(i,1,k+1);
        H1(m2-1,1) = 1/2*r2*u(i,m2+1,k+1);
        H2 = zeros(m2-1,1);
        H2(1:m2-1)=(1-r1)*u1(i,2:m2)+1/2*r1*u1(i+1,2:m2)+1/2*r1*u1(i-1,2:m2);
         row2 = zeros(m2-1, 1);
      row2(2, 1) = -1/2*r2;row2(1, 1) = 1+r2; 
      B = toeplitz(row2);
        u(i,2:m2,k+1) = chase(B,(H2+H1+dt/2*((ff5(x(i),y(2:m2),t(k))+ff5(x(i),y(2:m2),t(k+1)))/2)));
    end
end
F = zeros(m1+1,m2+1,n+1);
for i = 1:m1+1
    for j = 1:m2+1
        for k = 1:n+1
            F(i,j,k) = exp(1/2*(x(i)+y(j))-t(k));
        end
    end
end
error = abs(F-u);
figure(3)
    mesh(x(2:m1),y(2:m2),error(2:m1,2:m2,n+1))
    hold on
MaxErr(ii)=max(max(max(error)));
disp(MaxErr(ii));
end
for i=1:3
ord=MaxErr(i)/MaxErr(i+1);
disp(['收敛阶为',num2str(ord)]);
end
    figure(1)
    mesh(x, y, F(:, :, n+1));
    figure(2)
    mesh(x, y, u(:, :, n+1));
    elapsedTime = toc;

% 输出计时结果
disp(['程序运行时间为：', num2str(elapsedTime), '秒']);
    