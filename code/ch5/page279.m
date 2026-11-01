for ii=1:4
xa = 0; xb = 1;
ya = 0; yb = 1;
ta = 0; tb = 1;
m=10*2^(ii-1);
n=10*4^(ii-1);
h = (xb-xa)/m;
dt = (tb-ta)/n;
x = xa:h:xb;  x = x';
y = ya:h:yb;  y = y';
t = ta:dt:tb; t = t';
r = dt/h;
u = zeros(m+1,m+1,n+1);
for i = 1:m+1
    for j = 1:m+1
        u(i,j,1)   = exp(1/2*(x(i)+y(j))); 
    end
end
for j = 1:m+1
    for k = 1:n+1
        u(1,j,k)   = exp(1/2*y(j)-t(k));
        u(m+1,j,k) = exp(1/2*(1+y(j))-t(k)); 
    end
end
 ff5 = @(x,y,t) 1/2*exp(1/2*(x+y)-t);
ff51 = @(x,y) -exp(1/2*(x+y));
for i = 1:m+1
    for k = 1:n+1
        u(i,1,k)   = exp(1/2*x(i)-t(k));
        u(i,m+1,k) = exp(1/2*(1+x(i))-t(k));
    end
end
for k = 1:n    
  
    if k == 1        
        u1 = zeros(m+1,m+1);
        
        for j = 2:m      
            
            H1 = zeros(m-1,1);
            H1(1:m-1) = u(2:m,j,1)+1/2*dt*ff51(x(2:m),y(j))+1/4*dt^2*ff5(x(2:m),y(j),t(1))+...
1/12*((u(1:m-1,j,1) +1/2*dt*ff51(x(1:m-1),y(j)) +1/4*dt^2*ff5(x(1:m-1),y(j),t(1)) )-2*(u(2:m,j,1)+1/2*dt*ff51(x(2:m),y(j))+ ...
1/4*dt^2*ff5(x(2:m),y(j),t(1)))+(u(3:m+1,j,1)+1/2*dt*ff51(x(3:m+1),y(j))+1/4*dt^2*ff5(x(3:m+1),y(j),t(1))))+1/12*((u(2:m,j-1,1) +1/2*dt*ff51(x(2:m),y(j-1))+1/4*dt^2*ff5(x(2:m),y(j-1),t(1))-2*(u(2:m,j,1)+ ...
1/2*dt*ff51(x(2:m),y(j))+1/4*dt^2*ff5(x(2:m),y(j),t(1)))+(u(2:m,j+1,1) +1/2*dt*ff51(x(2:m),y(j+1)) +1/4*dt^2*ff5(x(2:m),y(j+1),t(1)))))+...
1/144*(((u(1:m-1,j-1,1) +1/2*dt*ff51(x(1:m-1),y(j-1))+1/4*dt^2*ff5(x(1:m-1),y(j-1),t(1)))-2*(u(1:m-1,j,1)+1/2*dt*ff51(x(1:m-1),y(j))+1/4*dt^2*ff5(x(1:m-1),y(j),t(1)))+(u(1:m-1,j+1,1)+ ...
1/2*dt*ff51(x(1:m-1),y(j+1))+1/4*dt^2*ff5(x(1:m-1),y(j+1),t(1))))-...
2*((u(2:m,j-1,1)+1/2*dt*ff51(x(2:m),y(j-1))+1/4*dt^2*ff5(x(2:m),y(j-1),t(1)))-2*(u(2:m,j,1)+1/2*dt*ff51(x(2:m),y(j))+1/4*dt^2*ff5(x(2:m),y(j),t(1)))+(u(2:m,j+1,1)+1/2*dt*ff51(x(2:m),y(j+1))+ ...
1/4*dt^2*ff5(x(2:m),y(j+1),t(1))))+...
((u(3:m+1,j-1,1) +1/2*dt*ff51(x(3:m+1),y(j-1))+1/4*dt^2*ff5(x(3:m+1),y(j-1),t(1)))-2*(u(3:m+1,j,1)+1/2*dt*ff51(x(3:m+1),y(j))+1/4*dt^2*ff5(x(3:m+1),y(j),t(1)))+(u(3:m+1,j+1,1) +1/2*dt*ff51(x(3:m+1),y(j+1))+ ...
1/4*dt^2*ff5(x(3:m+1),y(j+1),t(1)))))+...
1/144*(((u(1:m-1,j-1,1)+1/2*dt*ff51(x(1:m-1),y(j-1))+1/4*dt^2*ff5(x(1:m-1),y(j-1),t(1)))-2*(u(1:m-1,j,1)+1/2*dt*ff51(x(1:m-1),y(j))+1/4*dt^2*ff5(x(1:m-1),y(j),t(1)))...
+(u(1:m-1,j+1,1) +1/2*dt*ff51(x(1:m-1),y(j+1)) +1/4*dt^2*ff5(x(1:m-1),y(j+1),t(1))))-2*((u(2:m,j-1,1)+1/2*dt*ff51(x(2:m),y(j-1))+1/4*dt^2*ff5(x(2:m),y(j-1),t(1)))-2*(u(2:m,j,1)+ ...
1/2*dt*ff51(x(2:m),y(j))+1/4*dt^2*ff5(x(2:m),y(j),t(1)))+...
(u(2:m,j+1,1)+1/2*dt*ff51(x(2:m),y(j+1))+1/4*dt^2*ff5(x(2:m),y(j+1),t(1))))+((u(3:m+1,j-1,1)+1/2*dt*ff51(x(3:m+1),y(j-1))+1/4*dt^2*ff5(x(3:m+1),y(j-1),t(1)))-...
2*(u(3:m+1,j,1)+1/2*dt*ff51(x(3:m+1),y(j))+1/4*dt^2*ff5(x(3:m+1),y(j),t(1)))+(u(3:m+1,j+1,1)+1/2*dt*ff51(x(3:m+1),y(j+1))+1/4*dt^2*ff5(x(3:m+1),y(j+1),t(1)))));        
          
            u1(1,j)= 1/2*((u(1,j,1)+(1/12-1/4*r^2)*(u(1,j-1,1)-2*u(1,j,1)+u(1,j+1,1)))...
                             +(u(1,j,2)+(1/12-1/4*r^2)*(u(1,j-1,2)-2*u(1,j,2)+u(1,j+1,2))));
            u1(m+1,j) = 1/2*((u(m+1,j,1)+(1/12-1/4*r^2)*(u(m+1,j-1,1)-2*u(m+1,j,1)+u(m+1,j+1,1)))...
                             +(u(m+1,j,2)+(1/12-1/4*r^2)*(u(m+1,j-1,2)-2*u(m+1,j,2)+u(m+1,j+1,2))));
            
            H2 = zeros(m-1,1);
            H2(1,1)   = -(1/12-1/4*r^2)*u1(1,j);
            H2(m-1,1) = -(1/12-1/4*r^2)*u1(m+1,j);
            row1=zeros(m-1,1);
            row1(1,1)=5/6+1/2*r^2;row1(2,1)=1/12-1/4*r^2;
            A=toeplitz(row1);
            u1(2:m,j) = chase(A,(H1+H2));
        end
        
        uu1 = zeros(m+1,m+1);
        
        for i = 2:m            
            H7= zeros(m-1,1);
            H7(1:m-1) = u1(i,2:m);
            
            uu1(i,1)   = 1/2*(u(i,1,1)+u(i,1,2));
            uu1(i,m+1) = 1/2*(u(i,m+1,1)+u(i,m+1,2));
            
            H8 = zeros(m-1,1);
            H8(1,1)   = -(1/12-1/4*r^2)*uu1(i,1);
            H8(m-1,1) = -(1/12-1/4*r^2)*uu1(i,m+1);
            row2=zeros(m-1,1);
            row2(1,1)=5/6+1/2*r^2;row2(2,1)=1/12-1/4*r^2;
            B=toeplitz(row2);
            uu1(i,2:m) = chase(B,(H7+H8));
        end
        
        for i = 2:m
            for j = 2:m
                u(i,j,2) = 2*uu1(i,j)-u(i,j,1);
            end
        end
        
    else
   
        u2 = zeros(m+1,m+1);
        
        for j = 2:m
            H9 = zeros(m-1,1);
            H9(1:m-1) = u(2:m,j,k)+1/2*dt^2*ff5(x(2:m),y(j),t(k))+...
1/12*((u(1:m-1,j,k) +1/2*dt^2*ff5(x(1:m-1),y(j),t(k)))-2*(u(2:m,j,k)+1/2*dt^2*ff5(x(2:m),y(j),t(k)))+(u(3:m+1,j,k) +1/2*dt^2*ff5(x(3:m+1),y(j),t(k))))+...
1/12*((u(2:m,j-1,k) +1/2*dt^2*ff5(x(2:m),y(j-1),t(k)))-2*(u(2:m,j,k)+1/2*dt^2*ff5(x(2:m),y(j),t(k)))+(u(2:m,j+1,k) +1/2*dt^2*ff5(x(2:m),y(j+1),t(k))))+...
1/144*(((u(1:m-1,j-1,k) +1/2*dt^2*ff5(x(1:m-1),y(j-1),t(k)))-2*(u(1:m-1,j,k)+1/2*dt^2*ff5(x(1:m-1),y(j),t(k)))+(u(1:m-1,j+1,k)+1/2*dt^2*ff5(x(1:m-1),y(j+1),t(k))))-2*((u(2:m,j-1,k)+1/2*dt^2*ff5(x(2:m),y(j-1),t(k)))-...
2*(u(2:m,j,k)+1/2*dt^2*ff5(x(2:m),y(j),t(k)))+(u(2:m,j+1,k)+1/2*dt^2*ff5(x(2:m),y(j+1),t(k))))+((u(3:m+1,j-1,k)+1/2*dt^2*ff5(x(3:m+1),y(j-1),t(k)))-2*(u(3:m+1,j,k)+1/2*dt^2*ff5(x(3:m+1),y(j),t(k)))+ ...
(u(3:m+1,j+1,k) +1/2*dt^2*ff5(x(3:m+1),y(j+1),t(k)))));                   
            u2(1,j)   = 1/2*((u(1,j,k-1)+(1/12-1/2*r^2)*(u(1,j-1,k-1)-2*u(1,j,k-1)+u(1,j+1,k-1)))...
                             +(u(1,j,k+1)+(1/12-1/2*r^2)*(u(1,j-1,k+1)-2*u(1,j,k+1)+u(1,j+1,k+1))));
            u2(m+1,j) = 1/2*((u(m+1,j,k-1)+(1/12-1/2*r^2)*(u(m+1,j-1,k-1)-2*u(m+1,j,k-1)+u(m+1,j+1,k-1)))...
                             +(u(m+1,j,k+1)+(1/12-1/2*r^2)*(u(m+1,j-1,k+1)-2*u(m+1,j,k+1)+u(m+1,j+1,k+1))));
            
            H10 = zeros(m-1,1);
            H10(1,1)   = -(1/12-1/2*r^2)*u2(1,j);
            H10(m-1,1) = -(1/12-1/2*r^2)*u2(m+1,j);
            row3=zeros(m-1,1);
            row3(1,1)=5/6+r^2;row3(2,1)=1/12-1/2*r^2;
            C=toeplitz(row3);
            u2(2:m,j) = chase(C,(H10+H9));          
        end
        
        uu2 = zeros(m+1,m+1);
        
        for i = 2:m
            H11 = zeros(m-1,1);
            H11(1:m-1) = u2(i,2:m);
            
            uu2(i,1)   = 1/2*(u(i,1,k-1)+u(i,1,k+1));
            uu2(i,m+1) = 1/2*(u(i,m+1,k-1)+u(i,m+1,k+1));
            
            H12 = zeros(m-1,1);
            H12(1,1)   = -(1/12-1/2*r^2)*uu2(i,1);
            H12(m-1,1) = -(1/12-1/2*r^2)*uu2(i,m+1);
             row4=zeros(m-1,1);
            row4(1,1)=5/6+r^2;row4(2,1)=1/12-1/2*r^2;
            D=toeplitz(row4);
            uu2(i,2:m) = chase(D,(H11+H12));
        end            
        
        for i = 2:m
            for j = 2:m
                u(i,j,k+1) = 2*uu2(i,j)-u(i,j,k-1);
            end
        end       
    end
end

F = zeros(m+1,m+1,n+1);
for i = 1:m+1
    for j = 1:m+1
        for k = 1:n+1
            F(i,j,k) = exp(1/2*(x(i)+y(j))-t(k));
        end
    end
end
error = abs(F-u);
MaxErr(ii)=max(max(max(error)));
disp(MaxErr(ii));
  figure(3)
    mesh(x(2:m),y(2:m),error(2:m,2:m,end))
    hold on
end
for i=1:3
ord=MaxErr(i)/MaxErr(i+1);
disp(['收敛阶为',num2str(ord)]);
end
    figure(1)
    mesh(x, y, F(:, :, end));
     figure(2)
    mesh(x, y, u(:, :, end))